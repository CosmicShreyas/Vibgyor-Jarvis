from datetime import datetime

from fastapi import APIRouter, Depends
from pymongo.database import Database

from app.database import get_db
from app.deps import get_current_user
from app.schemas import QuoteBuilderConfigRead, QuoteBuilderConfigUpdate, UserRead
from app.skills import QUOTE_BUILDER_CONFIG_ID, get_quote_builder_config

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/quote-builder", response_model=QuoteBuilderConfigRead)
def get_quote_builder_catalog(
    db: Database = Depends(get_db),
    current_user: UserRead = Depends(get_current_user),
) -> QuoteBuilderConfigRead:
    _ = current_user
    config = get_quote_builder_config(db)
    return QuoteBuilderConfigRead(
        id=config["id"],
        modules_by_group={
            str(group): [str(item) for item in items]
            for group, items in config.get("modules_by_group", {}).items()
        },
        pricing_items=config.get("pricing_items", []),
    )


@router.put("/quote-builder", response_model=QuoteBuilderConfigRead)
def update_quote_builder_catalog(
    payload: QuoteBuilderConfigUpdate,
    db: Database = Depends(get_db),
    current_user: UserRead = Depends(get_current_user),
) -> QuoteBuilderConfigRead:
    _ = current_user
    sanitized_modules = {
        str(group): [item.strip() for item in items if item.strip()]
        for group, items in payload.modules_by_group.items()
    }
    sanitized_pricing_items = [item.model_dump() for item in payload.pricing_items]

    db.quote_builder_configs.update_one(
        {"id": QUOTE_BUILDER_CONFIG_ID},
        {
            "$set": {
                "modules_by_group": sanitized_modules,
                "pricing_items": sanitized_pricing_items,
                "updated_at": datetime.utcnow(),
            },
            "$setOnInsert": {"id": QUOTE_BUILDER_CONFIG_ID, "created_at": datetime.utcnow()},
        },
        upsert=True,
    )
    config = get_quote_builder_config(db)
    return QuoteBuilderConfigRead(
        id=config["id"],
        modules_by_group={
            str(group): [str(item) for item in items]
            for group, items in config.get("modules_by_group", {}).items()
        },
        pricing_items=config.get("pricing_items", []),
    )
