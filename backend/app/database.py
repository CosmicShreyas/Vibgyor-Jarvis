from collections.abc import Generator

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.database import Database

from app.config import get_settings

settings = get_settings()
client = MongoClient(settings.mongodb_url)
database = client[settings.mongodb_database]


def get_db() -> Generator[Database, None, None]:
    yield database


def init_indexes() -> None:
    database.users.create_index([("email", ASCENDING)], unique=True)
    database.users.create_index([("google_sub", ASCENDING)], unique=True, sparse=True)
    database.threads.create_index([("owner_id", ASCENDING), ("updated_at", DESCENDING)])
    database.messages.create_index([("thread_id", ASCENDING), ("created_at", ASCENDING)])
    database.signup_verifications.create_index([("email", ASCENDING)], unique=True)
    database.signup_verifications.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    database.quote_builder_configs.create_index([("id", ASCENDING)], unique=True)
