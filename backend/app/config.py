from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = Field(default="Jarvis API", alias="OPTIMUS_APP_NAME")
    env: str = Field(default="development", alias="OPTIMUS_ENV")
    api_v1_prefix: str = Field(default="/api/v1", alias="OPTIMUS_API_V1_PREFIX")
    frontend_url: str = Field(default="http://localhost:3000", alias="OPTIMUS_FRONTEND_URL")
    mongodb_url: str = Field(default="mongodb://localhost:27017", alias="OPTIMUS_MONGODB_URL")
    mongodb_database: str = Field(default="optimus", alias="OPTIMUS_MONGODB_DATABASE")
    secret_key: str = Field(default="change-me", alias="OPTIMUS_SECRET_KEY")
    access_token_expire_minutes: int = Field(
        default=60 * 24 * 7, alias="OPTIMUS_ACCESS_TOKEN_EXPIRE_MINUTES"
    )
    ollama_model: str = Field(default="llama3.1:8b", alias="OPTIMUS_OLLAMA_MODEL")
    ollama_base_url: str = Field(default="http://localhost:11434", alias="OPTIMUS_OLLAMA_BASE_URL")
    smtp_host: str = Field(default="smtp.gmail.com", alias="OPTIMUS_SMTP_HOST")
    smtp_port: int = Field(default=587, alias="OPTIMUS_SMTP_PORT")
    smtp_username: str = Field(default="", alias="OPTIMUS_SMTP_USERNAME")
    smtp_password: str = Field(default="", alias="OPTIMUS_SMTP_PASSWORD")
    smtp_from_email: str = Field(default="", alias="OPTIMUS_SMTP_FROM_EMAIL")
    smtp_from_name: str = Field(default="Jarvis", alias="OPTIMUS_SMTP_FROM_NAME")
    signup_code_expire_minutes: int = Field(default=10, alias="OPTIMUS_SIGNUP_CODE_EXPIRE_MINUTES")
    google_client_id: str = Field(default="", alias="OPTIMUS_GOOGLE_CLIENT_ID")
    google_client_secret: str = Field(default="", alias="OPTIMUS_GOOGLE_CLIENT_SECRET")
    google_redirect_uri: str = Field(
        default="http://localhost:8000/api/v1/auth/google/callback",
        alias="OPTIMUS_GOOGLE_REDIRECT_URI",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
