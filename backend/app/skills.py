from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from ollama import Client
from pymongo.database import Database

SKILL_QUOTE_BUILDER = "quote_builder"
QUOTE_BUILDER_CONFIG_ID = "quote_builder"
MM_PER_SQFT = 92903.04
JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)
THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


@dataclass(frozen=True)
class PricingItem:
    carcase_core: str
    carcase_finish: str
    shutter_core: str
    shutter_finish: str
    price: float


@dataclass(frozen=True)
class RequestedModule:
    label: str
    width_mm: float
    height_mm: float
    details: str = ""

    @property
    def area_sqft(self) -> float:
        return (self.width_mm * self.height_mm) / MM_PER_SQFT


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _strip_thinking(value: str) -> str:
    return THINK_RE.sub("", value).strip()


def _parse_json_object(value: str) -> dict[str, Any]:
    cleaned = _strip_thinking(value)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = JSON_BLOCK_RE.search(cleaned)
        if not match:
            raise
        return json.loads(match.group(0))


def _format_currency(value: float) -> str:
    return f"₹{value:,.2f}"


def _format_dimension(value_mm: float) -> str:
    rounded = round(value_mm)
    if abs(value_mm - rounded) < 0.01:
        return str(int(rounded))
    return f"{value_mm:.1f}"


def _unit_to_mm(value: float, unit: str | None) -> float:
    normalized = (unit or "mm").strip().lower()
    if normalized in {"mm", "millimeter", "millimeters"}:
        return value
    if normalized in {"cm", "centimeter", "centimeters"}:
        return value * 10
    if normalized in {"m", "meter", "meters"}:
        return value * 1000
    if normalized in {"ft", "feet", "foot", "'"}:
        return value * 304.8
    if normalized in {"in", "inch", "inches", "\""}:
        return value * 25.4
    return value


@lru_cache
def load_default_quote_builder_pricing_items() -> tuple[PricingItem, ...]:
    payload = json.loads(
        (_repo_root() / "backend" / "app" / "data" / "kitchen_pricing_catalog.json").read_text(
            encoding="utf-8"
        )
    )
    unique_items: dict[tuple[str, str, str, str, float], PricingItem] = {}
    for item in payload:
        pricing_item = PricingItem(
            carcase_core=item["carcase_core"],
            carcase_finish=item["carcase_finish"],
            shutter_core=item["shutter_core"],
            shutter_finish=item["shutter_finish"],
            price=float(item["price"]),
        )
        key = (
            pricing_item.carcase_core,
            pricing_item.carcase_finish,
            pricing_item.shutter_core,
            pricing_item.shutter_finish,
            pricing_item.price,
        )
        unique_items[key] = pricing_item
    return tuple(unique_items.values())


@lru_cache
def load_default_quote_builder_modules_by_group() -> dict[str, list[str]]:
    payload = json.loads(
        (_repo_root() / "backend" / "app" / "data" / "kitchen_modules.json").read_text(
            encoding="utf-8"
        )
    )
    return {
        str(group): [str(item).strip() for item in items if str(item).strip()]
        for group, items in payload.items()
    }


@lru_cache
def load_default_quote_builder_modules() -> tuple[str, ...]:
    payload = load_default_quote_builder_modules_by_group()
    values: list[str] = []
    for items in payload.values():
        values.extend(str(item) for item in items)
    values.append("Kitchen Cabinet")
    return tuple(sorted({item.strip() for item in values if item and item.strip()}, key=len, reverse=True))


def pricing_item_to_document(item: PricingItem) -> dict[str, Any]:
    return {
        "carcase_core": item.carcase_core,
        "carcase_finish": item.carcase_finish,
        "shutter_core": item.shutter_core,
        "shutter_finish": item.shutter_finish,
        "price": item.price,
    }


def pricing_item_from_document(item: dict[str, Any]) -> PricingItem:
    return PricingItem(
        carcase_core=str(item.get("carcase_core", "")),
        carcase_finish=str(item.get("carcase_finish", "")),
        shutter_core=str(item.get("shutter_core", "")),
        shutter_finish=str(item.get("shutter_finish", "")),
        price=float(item.get("price", 0)),
    )


def build_default_quote_builder_config() -> dict[str, Any]:
    return {
        "id": QUOTE_BUILDER_CONFIG_ID,
        "modules_by_group": load_default_quote_builder_modules_by_group(),
        "pricing_items": [
            pricing_item_to_document(item) for item in load_default_quote_builder_pricing_items()
        ],
    }


def get_quote_builder_config(db: Database) -> dict[str, Any]:
    config = db.quote_builder_configs.find_one({"id": QUOTE_BUILDER_CONFIG_ID})
    if config:
        if "pricing_items" not in config and config.get("pricing_rows"):
            migrated_items = [
                pricing_item_to_document(pricing_item_from_document(item))
                for item in config.get("pricing_rows", [])
            ]
            db.quote_builder_configs.update_one(
                {"id": QUOTE_BUILDER_CONFIG_ID},
                {"$set": {"pricing_items": migrated_items}, "$unset": {"pricing_rows": ""}},
            )
            config["pricing_items"] = migrated_items
        return config

    config = build_default_quote_builder_config()
    db.quote_builder_configs.insert_one(config)
    return config


def get_quote_builder_modules(db: Database) -> tuple[str, ...]:
    config = get_quote_builder_config(db)
    values: list[str] = []
    for items in config.get("modules_by_group", {}).values():
        values.extend(str(item).strip() for item in items if str(item).strip())
    values.append("Kitchen Cabinet")
    return tuple(sorted({item for item in values if item}, key=len, reverse=True))


def get_quote_builder_pricing_items(db: Database) -> tuple[PricingItem, ...]:
    config = get_quote_builder_config(db)
    return tuple(pricing_item_from_document(item) for item in config.get("pricing_items", []))


def default_quote_builder_markdown() -> str:
    modules = "\n".join(f"- {module}" for module in load_default_quote_builder_modules())
    return "\n".join(
        [
            "# Quote Builder",
            "",
            "You are Vibgyor's quote-building skill for modular kitchen pricing.",
            "",
            "## Your job",
            "- Understand kitchen pricing prompts even when dimensions are written in mm, cm, m, feet, foot, ft, inches, in, or mixed human phrasing.",
            "- Recognize cabinet module names such as:",
            modules,
            "- Infer the requested carcase catalog when the user mentions `BWP Ply` or `MR Ply`.",
            "- Infer finish keywords such as `laminate`, `acrylic`, `PU paint`, `Duco`, `cutout`, `glass sandwich`, `wallpaper`, `fabric`, `wicker`, `OSL`, and `BSL`.",
            "",
            "## Extraction rules",
            "- Output only valid JSON when asked to extract a quote request.",
            "- Convert nothing yourself in the JSON. Preserve the original unit label for each dimension.",
            "- If a detail is missing, return `null` for that field and add a short note in `assumptions`.",
            "",
            "## Response style",
            "- When asked to format the final answer, respond in polished Markdown.",
            "- Keep all numbers exactly as provided in the calculation payload.",
            "- Include a matched specification section, per-module breakdown, total, and assumptions.",
            "- Do not invent prices or dimensions that are not present in the calculation payload.",
        ]
    )


def _extract_quote_request(
    client: Client,
    *,
    prompt: str,
    skill_markdown: str,
    model: str,
    modules: tuple[str, ...],
) -> dict[str, Any]:
    module_list = "\n".join(f"- {module}" for module in modules)
    extraction_prompt = "\n".join(
        [
            skill_markdown,
            "",
            "Return only JSON with this schema:",
            "{",
            '  "intent": "quote_builder" | "other",',
            '  "carcase_catalog": "BWP Ply" | "MR Ply" | null,',
            '  "finish_keywords": string[],',
            '  "modules": [',
            "    {",
            '      "label": string,',
            '      "width": {"value": number, "unit": string | null},',
            '      "height": {"value": number, "unit": string | null},',
            '      "details": string | null',
            "    }",
            "  ],",
            '  "assumptions": string[]',
            "}",
            "",
            "Recognized modules:",
            module_list,
            "",
            f"User request:\n{prompt}",
        ]
    )
    response = client.chat(
        model=model,
        messages=[{"role": "system", "content": extraction_prompt}],
    )
    content = response.message.content if response.message else "{}"
    return _parse_json_object(content)


def _select_catalog(extracted: dict[str, Any]) -> tuple[str, list[str]]:
    assumptions = list(extracted.get("assumptions") or [])
    catalog = (extracted.get("carcase_catalog") or "").strip()
    if catalog in {"BWP Ply", "MR Ply"}:
        return catalog, assumptions

    assumptions.append("Carcase core assumed as BWP Ply because the request did not clearly specify BWP Ply or MR Ply.")
    return "BWP Ply", assumptions


FINISH_SIGNAL_ALIASES: dict[str, tuple[str, ...]] = {
    "laminate": ("laminate", "lam"),
    "cutout": ("cutout",),
    "glass": ("glass", "glass detail", "glass shutter"),
    "glass sandwich": ("glass sandwich", "sandwich glass", "glass sandwich wallpaper"),
    "wallpaper": ("wallpaper", "wall paper"),
    "fabric": ("fabric",),
    "wicker": ("wicker",),
    "acrylic": ("acrylic",),
    "1mm": ("1mm", "1 mm"),
    "1.5mm": ("1.5mm", "1.5 mm"),
    "2mm": ("2mm", "2 mm"),
    "pu paint": ("pu paint", "pu", "paint"),
    "duco": ("duco",),
    "grooves": ("grooves", "groove"),
    "routing": ("routing", "route"),
    "osl": ("osl",),
    "bsl": ("bsl",),
}


def _collect_finish_signals(prompt: str, keywords: list[str]) -> list[str]:
    signals = {_normalize(keyword) for keyword in keywords if keyword}
    prompt_text = _normalize(prompt)
    for canonical, aliases in FINISH_SIGNAL_ALIASES.items():
        if any(_normalize(alias) in prompt_text for alias in aliases):
            signals.add(_normalize(canonical))
    return [signal for signal in signals if signal]


def _candidate_pricing_summary(items: list[PricingItem]) -> str:
    lines: list[str] = []
    for index, item in enumerate(items):
        lines.append(
            f"{index}: carcase={item.carcase_core} / {item.carcase_finish}; "
            f"shutter={item.shutter_core} / {item.shutter_finish}; "
            f"price={item.price:.2f}"
        )
    return "\n".join(lines)


def _module_selection_prompt(base_prompt: str, module: RequestedModule) -> str:
    module_lines = [
        f"Module label: {module.label}",
        f"Module size: {_format_dimension(module.width_mm)} mm x {_format_dimension(module.height_mm)} mm",
    ]
    if module.details:
        module_lines.append(f"Module-specific details: {module.details}")
    return f"{base_prompt}\n\nFocus only on this module:\n" + "\n".join(module_lines)


def _ai_select_pricing_item(
    client: Client,
    *,
    prompt: str,
    extracted: dict[str, Any],
    candidates: list[PricingItem],
    model: str,
) -> int | None:
    if not candidates:
        return None

    selection_prompt = "\n".join(
        [
            "You are selecting the exact pricing item for a modular cabinet quote.",
            "Choose the single best candidate based on the user's requested material and finish combination.",
            "Prioritize exact shutter-finish matching, then carcase/shutter core compatibility.",
            "Do not calculate price. Do not explain. Return JSON only.",
            "",
            "Return this schema:",
            '{ "match_index": number | null }',
            "",
            f"User request:\n{prompt}",
            "",
            "Extracted request JSON:",
            json.dumps(extracted, ensure_ascii=False, indent=2),
            "",
            "Candidate pricing items:",
            _candidate_pricing_summary(candidates),
        ]
    )
    response = client.chat(
        model=model,
        messages=[{"role": "system", "content": selection_prompt}],
    )
    content = response.message.content if response.message else "{}"
    parsed = _parse_json_object(content)
    match_index = parsed.get("match_index")
    if isinstance(match_index, int) and 0 <= match_index < len(candidates):
        return match_index
    return None


def _keyword_score(keywords: list[str], item: PricingItem, prompt: str) -> int:
    row_text = _normalize(
        " ".join(
            [
                item.carcase_core,
                item.carcase_finish,
                item.shutter_core,
                item.shutter_finish,
            ]
        )
    )
    prompt_text = _normalize(prompt)
    weights = {
        "laminate with cutout": 20,
        "glass sandwich": 20,
        "glass": 10,
        "wallpaper": 12,
        "fabric": 12,
        "wicker": 12,
        "acrylic": 14,
        "pu paint": 16,
        "duco": 16,
        "grooves": 10,
        "routing": 10,
        "osl": 6,
        "bsl": 6,
        "laminate": 6,
    }

    score = 0
    normalized_keywords = [_normalize(keyword) for keyword in keywords if keyword]
    for keyword in normalized_keywords:
        if keyword in row_text:
            score += weights.get(keyword, 4)
    shutter_finish = _normalize(item.shutter_finish)
    carcase_core = _normalize(item.carcase_core)
    carcase_finish = _normalize(item.carcase_finish)
    if shutter_finish and shutter_finish in normalized_keywords:
        score += 36
    if shutter_finish and shutter_finish in prompt_text:
        score += 64
    if carcase_core and carcase_core in prompt_text:
        score += 22
    if carcase_finish and carcase_finish in prompt_text:
        score += 18

    for canonical, aliases in FINISH_SIGNAL_ALIASES.items():
        normalized_canonical = _normalize(canonical)
        if normalized_canonical not in normalized_keywords:
            continue
        if any(_normalize(alias) in row_text for alias in aliases):
            score += weights.get(normalized_canonical, 6) + 10

    if "glass" in normalized_keywords and "glass" not in row_text:
        score -= 16
    if "acrylic" in normalized_keywords and "acrylic" not in row_text:
        score -= 16
    if "cutout" in normalized_keywords and "cutout" not in row_text:
        score -= 16
    if "pu paint" in normalized_keywords and "pu paint" not in row_text:
        score -= 20
    if "duco" in normalized_keywords and "duco" not in row_text:
        score -= 20
    return score


def _select_pricing_row(
    client: Client,
    carcase_core: str,
    prompt: str,
    extracted: dict[str, Any],
    finish_keywords: list[str],
    pricing_items: tuple[PricingItem, ...],
    model: str,
) -> tuple[PricingItem, list[str]]:
    assumptions: list[str] = []
    rows = [
        item
        for item in pricing_items
        if _normalize(item.carcase_core) == _normalize(carcase_core)
    ]
    if not rows:
        raise ValueError(f"No pricing rows found for carcase core '{carcase_core}'.")

    ai_match_index = _ai_select_pricing_item(
        client,
        prompt=prompt,
        extracted=extracted,
        candidates=rows,
        model=model,
    )
    if ai_match_index is not None:
        return rows[ai_match_index], assumptions

    finish_signals = _collect_finish_signals(prompt, finish_keywords)
    scored = sorted(rows, key=lambda item: (_keyword_score(finish_signals, item, prompt), item.price), reverse=True)
    best = scored[0]
    if _keyword_score(finish_signals, best, prompt) > 0:
        return best, assumptions

    default_row = next((item for item in rows if _normalize(item.shutter_finish) == "laminate"), rows[0])
    assumptions.append("Shutter finish assumed as Laminate because the request did not clearly match a more specific finish from the rate card.")
    return default_row, assumptions


def _build_requested_modules(extracted: dict[str, Any]) -> list[RequestedModule]:
    requested: list[RequestedModule] = []
    for module in extracted.get("modules") or []:
        label = str(module.get("label") or "").strip()
        width = module.get("width") or {}
        height = module.get("height") or {}
        if not label or width.get("value") is None or height.get("value") is None:
            continue
        requested.append(
            RequestedModule(
                label=label,
                width_mm=_unit_to_mm(float(width["value"]), width.get("unit")),
                height_mm=_unit_to_mm(float(height["value"]), height.get("unit")),
                details=str(module.get("details") or "").strip(),
            )
        )
    return requested


def _build_missing_details_reply() -> str:
    return "\n".join(
        [
            "**Quote Builder**",
            "",
            "I can build this quote, but I still need clearer module dimensions.",
            "",
            "Use a format like:",
            "- Wall Unit: 1200 x 720 mm",
            "- Base Unit: 3 ft x 2.75 ft",
            "- Tall Unit: 24 in x 84 in",
            "",
            "You can also mention finish details such as `BWP Ply`, `MR Ply`, `Laminate`, `Acrylic`, `PU Paint`, or `Duco`.",
        ]
    )


def _build_calculation_payload(
    *,
    prompt: str,
    extracted: dict[str, Any],
    module_matches: list[tuple[RequestedModule, PricingItem]],
    assumptions: list[str],
) -> dict[str, Any]:
    breakdown = []
    total = 0.0
    for module, pricing_item in module_matches:
        subtotal = module.area_sqft * pricing_item.price
        total += subtotal
        breakdown.append(
            {
                "label": module.label,
                "details": module.details,
                "width_mm": round(module.width_mm, 2),
                "height_mm": round(module.height_mm, 2),
                "area_sqft": round(module.area_sqft, 4),
                "rate_per_sqft": round(pricing_item.price, 2),
                "subtotal": round(subtotal, 2),
                "formula": f"({_format_dimension(module.width_mm)} x {_format_dimension(module.height_mm)}) / {MM_PER_SQFT:.2f}",
                "matched_specification": {
                    "carcase_core": pricing_item.carcase_core,
                    "carcase_finish": pricing_item.carcase_finish,
                    "shutter_core": pricing_item.shutter_core,
                    "shutter_finish": pricing_item.shutter_finish,
                },
            }
        )

    return {
        "user_prompt": prompt,
        "breakdown": breakdown,
        "total": round(total, 2),
        "finish_keywords": extracted.get("finish_keywords") or [],
        "assumptions": assumptions,
    }


def _fallback_markdown_reply(calculation_payload: dict[str, Any]) -> str:
    lines = [
        "## Modular Kitchen Quotation",
        "",
        "Here is the quotation based on the matched cabinet specifications and the requested module sizes.",
        "",
        "### Calculation breakdown",
    ]
    for item in calculation_payload["breakdown"]:
        spec = item["matched_specification"]
        lines.extend(
            [
                f"**{item['label']}**",
                *([f"- Requested finish details: {item['details']}"] if item.get("details") else []),
                f"- Size: {_format_dimension(float(item['width_mm']))} x {_format_dimension(float(item['height_mm']))} mm",
                f"- Matched specification: {spec['carcase_core']} / {spec['carcase_finish']} with {spec['shutter_core']} / {spec['shutter_finish']}",
                f"- Rate used: {_format_currency(float(item['rate_per_sqft']))} per sq ft",
                f"- Area: {float(item['area_sqft']):.2f} sq ft",
                f"- Formula: {item['formula']} = {float(item['area_sqft']):.2f} sq ft",
                f"- Subtotal: {float(item['area_sqft']):.2f} x {_format_currency(float(item['rate_per_sqft']))} = {_format_currency(float(item['subtotal']))}",
                "",
            ]
        )
    lines.extend(
        [
            "",
            f"### Total estimated price: {_format_currency(float(calculation_payload['total']))}",
            "",
            "_Note: The above quotation is exclusive of GST._",
            "",
            "### Assumptions",
        ]
    )
    lines.extend(f"- {assumption}" for assumption in calculation_payload["assumptions"])
    return _normalize_quote_builder_currency("\n".join(lines))


def _normalize_quote_builder_currency(content: str) -> str:
    normalized = content.replace("Rs.", "₹").replace("Rs ", "₹").replace("INR ", "₹")
    normalized = re.sub(r"(?<!\w)\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)", r"₹\1", normalized)
    normalized = re.sub(r"\bUSD\s*([0-9][0-9,]*(?:\.[0-9]+)?)", r"₹\1", normalized, flags=re.IGNORECASE)
    normalized = normalized.replace(" per sq ft", " per sq ft")
    return normalized


def _clean_quote_builder_render(content: str, *, strip_edges: bool = True) -> str:
    cleaned = THINK_RE.sub("", content)
    cleaned = cleaned.replace(r"\text{", "").replace("}", "")
    cleaned = cleaned.replace(r"\(", "").replace(r"\)", "")
    cleaned = cleaned.replace(r"\[", "").replace(r"\]", "")
    cleaned = re.sub(r"\$+", "", cleaned)
    cleaned = _normalize_quote_builder_currency(cleaned)
    return cleaned.strip() if strip_edges else cleaned


def _build_quote_render_payload(calculation_payload: dict[str, Any]) -> dict[str, Any]:
    return dict(calculation_payload)


def _build_quote_render_messages(
    *,
    skill_markdown: str,
    calculation_payload: dict[str, Any],
) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": "\n".join(
                [
                    skill_markdown,
                    "",
                    "You are Jarvis preparing a final modular kitchen quotation reply.",
                    "The pricing and calculations are already verified.",
                    "",
                    "Rules:",
                    "- Use only the numbers and facts provided in the payload.",
                    "- Do not change, infer, or recompute any price, subtotal, area, or total.",
                    "- Do not mention workbook names, Excel files, sheet names, rows, internal source tracking, or backend implementation details.",
                    "- Write polished, natural Markdown suitable for chat.",
                    "- Use plain GitHub-flavored Markdown only.",
                    "- Do not use LaTeX, \\text, escaped math, code fences, or dollar-sign math notation.",
                    "- Keep all currency in rupees using the ₹ symbol.",
                    "- Explicitly state that the quoted price is exclusive of GST.",
                    "- Include a concise intro, matched specification, calculation breakdown, total estimated price, and assumptions.",
                    "- Return only the final answer body.",
                ]
            ),
        },
        {
            "role": "user",
            "content": "Verified calculation payload:\n"
            + json.dumps(calculation_payload, ensure_ascii=False, indent=2),
        },
    ]


def _prepare_quote_builder_payload(
    db: Database,
    client: Client,
    *,
    latest_user_message: str,
    skill_markdown: str,
    model: str,
) -> dict[str, Any] | None:
    modules = get_quote_builder_modules(db)
    pricing_items = get_quote_builder_pricing_items(db)
    extracted = _extract_quote_request(
        client,
        prompt=latest_user_message,
        skill_markdown=skill_markdown,
        model=model,
        modules=modules,
    )
    if extracted.get("intent") != "quote_builder":
        return None

    requested_modules = _build_requested_modules(extracted)
    if not requested_modules:
        return {"missing_reply": _build_missing_details_reply()}

    catalog, assumptions = _select_catalog(extracted)
    module_matches: list[tuple[RequestedModule, PricingItem]] = []
    for module in requested_modules:
        module_prompt = _module_selection_prompt(latest_user_message, module)
        pricing_item, row_assumptions = _select_pricing_row(
            client,
            catalog,
            module_prompt,
            extracted,
            list(extracted.get("finish_keywords") or []),
            pricing_items,
            model,
        )
        assumptions.extend(row_assumptions)
        module_matches.append((module, pricing_item))

    assumptions.append(
        "Each module has been matched independently against the pricing JSON before calculating its area-based subtotal."
    )
    assumptions.append("All dimensions were normalized to millimetres before converting area to square feet.")
    assumptions.append("The quoted prices are exclusive of GST.")

    return {
        "calculation_payload": _build_calculation_payload(
            prompt=latest_user_message,
            extracted=extracted,
            module_matches=module_matches,
            assumptions=assumptions,
        )
    }


def _render_quote_builder_reply(
    client: Client,
    *,
    calculation_payload: dict[str, Any],
    skill_markdown: str,
    model: str,
) -> str:
    safe_payload = _build_quote_render_payload(calculation_payload)
    response = client.chat(
        model=model,
        messages=_build_quote_render_messages(
            skill_markdown=skill_markdown,
            calculation_payload=safe_payload,
        ),
    )
    content = _clean_quote_builder_render(response.message.content if response.message else "")
    return content or _fallback_markdown_reply(safe_payload)


def _stream_quote_builder_reply(
    client: Client,
    *,
    calculation_payload: dict[str, Any],
    skill_markdown: str,
    model: str,
):
    safe_payload = _build_quote_render_payload(calculation_payload)
    stream = client.chat(
        model=model,
        messages=_build_quote_render_messages(
            skill_markdown=skill_markdown,
            calculation_payload=safe_payload,
        ),
        stream=True,
    )
    saw_content = False
    for chunk in stream:
        content = ""
        if getattr(chunk, "message", None):
            content = chunk.message.content or ""
        elif isinstance(chunk, dict):
            content = chunk.get("message", {}).get("content", "")
        cleaned = _clean_quote_builder_render(content, strip_edges=False)
        if cleaned:
            saw_content = True
            yield cleaned

    if not saw_content:
        yield _fallback_markdown_reply(safe_payload)


def generate_skill_reply(
    db: Database,
    messages: list[dict[str, Any]],
    *,
    enabled_skills: list[str] | None,
    skill_configs: dict[str, str] | None,
    model: str,
    ollama_base_url: str,
) -> str | None:
    if SKILL_QUOTE_BUILDER not in set(enabled_skills or []):
        return None

    latest_user_message = next(
        (message.get("content", "") for message in reversed(messages) if message.get("role") == "user"),
        "",
    ).strip()
    if not latest_user_message:
        return None

    client = Client(host=ollama_base_url)
    skill_markdown = (skill_configs or {}).get(SKILL_QUOTE_BUILDER) or default_quote_builder_markdown()
    prepared = _prepare_quote_builder_payload(
        db,
        client,
        latest_user_message=latest_user_message,
        skill_markdown=skill_markdown,
        model=model,
    )
    if prepared is None:
        return None
    if "missing_reply" in prepared:
        return str(prepared["missing_reply"])
    return _render_quote_builder_reply(
        client,
        calculation_payload=prepared["calculation_payload"],
        skill_markdown=skill_markdown,
        model=model,
    )


def stream_skill_reply(
    db: Database,
    messages: list[dict[str, Any]],
    *,
    enabled_skills: list[str] | None,
    skill_configs: dict[str, str] | None,
    model: str,
    ollama_base_url: str,
):
    if SKILL_QUOTE_BUILDER not in set(enabled_skills or []):
        return None

    latest_user_message = next(
        (message.get("content", "") for message in reversed(messages) if message.get("role") == "user"),
        "",
    ).strip()
    if not latest_user_message:
        return None

    client = Client(host=ollama_base_url)
    skill_markdown = (skill_configs or {}).get(SKILL_QUOTE_BUILDER) or default_quote_builder_markdown()
    prepared = _prepare_quote_builder_payload(
        db,
        client,
        latest_user_message=latest_user_message,
        skill_markdown=skill_markdown,
        model=model,
    )
    if prepared is None:
        return None
    if "missing_reply" in prepared:
        def simple_stream():
            yield str(prepared["missing_reply"])
        return simple_stream()

    return _stream_quote_builder_reply(
        client,
        calculation_payload=prepared["calculation_payload"],
        skill_markdown=skill_markdown,
        model=model,
    )
