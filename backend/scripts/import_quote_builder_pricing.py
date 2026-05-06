from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import get_settings  # noqa: E402
from app.database import client  # noqa: E402
from app.skills import QUOTE_BUILDER_CONFIG_ID, get_quote_builder_config  # noqa: E402

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
DATA_START_ROW = 7


@dataclass(frozen=True)
class PricingItem:
    carcase_core: str
    carcase_finish: str
    shutter_core: str
    shutter_finish: str
    price: float


def normalize_text(value: object) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\n", " ").split()).strip()


def column_letters(cell_ref: str) -> str:
    letters = []
    for char in cell_ref:
        if char.isalpha():
            letters.append(char)
        else:
            break
    return "".join(letters)


def row_number(cell_ref: str) -> int:
    digits = []
    for char in cell_ref:
        if char.isdigit():
            digits.append(char)
    return int("".join(digits) or 0)


def load_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        xml_bytes = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []

    root = ET.fromstring(xml_bytes)
    values: list[str] = []
    for item in root.findall("main:si", NS):
        text_parts = [node.text or "" for node in item.findall(".//main:t", NS)]
        values.append("".join(text_parts))
    return values


def read_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//main:t", NS))

    value_node = cell.find("main:v", NS)
    if value_node is None or value_node.text is None:
        return ""

    raw = value_node.text
    if cell_type == "s":
        try:
            return shared_strings[int(raw)]
        except (ValueError, IndexError):
            return ""
    return raw


def workbook_sheet_paths(archive: zipfile.ZipFile) -> list[str]:
    workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
    rels_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))

    rel_map: dict[str, str] = {}
    for rel in rels_root.findall("pkgrel:Relationship", NS):
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        if rel_id and target:
            rel_map[rel_id] = target.replace("\\", "/")

    paths: list[str] = []
    for sheet in workbook_root.findall("main:sheets/main:sheet", NS):
        rel_id = sheet.attrib.get(f"{{{NS['rel']}}}id")
        if not rel_id or rel_id not in rel_map:
            continue
        target = rel_map[rel_id]
        if not target.startswith("xl/"):
            target = f"xl/{target}"
        paths.append(target)
    return paths


def read_sheet_rows(archive: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> dict[int, dict[str, str]]:
    root = ET.fromstring(archive.read(sheet_path))
    rows: dict[int, dict[str, str]] = {}
    for row in root.findall(".//main:sheetData/main:row", NS):
        row_index = int(row.attrib.get("r", "0"))
        row_values: dict[str, str] = {}
        for cell in row.findall("main:c", NS):
            cell_ref = cell.attrib.get("r", "")
            if not cell_ref:
                continue
            row_values[column_letters(cell_ref)] = normalize_text(read_cell_value(cell, shared_strings))
        if row_values:
            rows[row_index] = row_values
    return rows


def read_pricing_items_from_workbook(path: Path) -> list[PricingItem]:
    extracted: list[PricingItem] = []
    with zipfile.ZipFile(path) as archive:
        shared_strings = load_shared_strings(archive)
        for sheet_path in workbook_sheet_paths(archive):
            rows = read_sheet_rows(archive, sheet_path, shared_strings)
            if normalize_text(rows.get(5, {}).get("B", "")).lower() != "name":
                continue

            for row_index in sorted(rows):
                if row_index < DATA_START_ROW:
                    continue
                row = rows[row_index]
                carcase_core = row.get("C", "")
                carcase_finish = row.get("D", "")
                shutter_core = row.get("E", "")
                shutter_finish = row.get("F", "")
                price_value = row.get("H", "")

                if not (carcase_core and carcase_finish and shutter_core and shutter_finish and price_value):
                    continue

                try:
                    price = float(price_value)
                except ValueError:
                    continue

                extracted.append(
                    PricingItem(
                        carcase_core=carcase_core,
                        carcase_finish=carcase_finish,
                        shutter_core=shutter_core,
                        shutter_finish=shutter_finish,
                        price=price,
                    )
                )
    return extracted


def unique_pricing_items(items: list[PricingItem]) -> list[PricingItem]:
    seen: dict[tuple[str, str, str, str, float], PricingItem] = {}
    for item in items:
        key = (
            item.carcase_core,
            item.carcase_finish,
            item.shutter_core,
            item.shutter_finish,
            item.price,
        )
        seen[key] = item
    return list(seen.values())


def main() -> None:
    workbook_paths = [
        ROOT / "Kitchen_BWP PLY - 3.4.26.xlsx",
        ROOT / "Kitchen_MR PLY - 3.4.26.xlsx",
    ]

    all_items: list[PricingItem] = []
    for workbook_path in workbook_paths:
        if not workbook_path.exists():
            raise FileNotFoundError(f"Workbook not found: {workbook_path}")
        all_items.extend(read_pricing_items_from_workbook(workbook_path))

    pricing_items = unique_pricing_items(all_items)
    if not pricing_items:
        raise RuntimeError("No pricing items were extracted from the workbook files.")

    settings = get_settings()
    database = client[settings.mongodb_database]
    existing_config = get_quote_builder_config(database)
    modules_by_group = existing_config.get("modules_by_group", {})

    database.quote_builder_configs.update_one(
        {"id": QUOTE_BUILDER_CONFIG_ID},
        {
            "$set": {
                "modules_by_group": modules_by_group,
                "pricing_items": [asdict(item) for item in pricing_items],
                "updated_at": datetime.now(UTC),
            },
            "$setOnInsert": {
                "id": QUOTE_BUILDER_CONFIG_ID,
                "created_at": datetime.now(UTC),
            },
            "$unset": {"pricing_rows": ""},
        },
        upsert=True,
    )

    print(json.dumps([asdict(item) for item in pricing_items], ensure_ascii=False, indent=2))
    print(f"\nImported {len(pricing_items)} pricing items into MongoDB collection 'quote_builder_configs'.")


if __name__ == "__main__":
    main()
