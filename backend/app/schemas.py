from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class AttachmentPayload(BaseModel):
    id: str
    name: str
    size: int
    type: str
    preview: str | None = None


class QuoteBuilderSpecPart(BaseModel):
    carcase_core: str = Field(default="", max_length=255)
    carcase_finish: str = Field(default="", max_length=255)
    shutter_core: str = Field(default="", max_length=255)
    shutter_finish: str = Field(default="", max_length=255)


class QuoteBuilderPricingItem(BaseModel):
    carcase_core: str = Field(default="", max_length=255)
    carcase_finish: str = Field(default="", max_length=255)
    shutter_core: str = Field(default="", max_length=255)
    shutter_finish: str = Field(default="", max_length=255)
    price: float = Field(ge=0)


class QuoteBuilderConfigRead(BaseModel):
    id: str = "quote_builder"
    modules_by_group: dict[str, list[str]] = Field(default_factory=dict)
    pricing_items: list[QuoteBuilderPricingItem] = Field(default_factory=list)


class QuoteBuilderConfigUpdate(BaseModel):
    modules_by_group: dict[str, list[str]] = Field(default_factory=dict)
    pricing_items: list[QuoteBuilderPricingItem] = Field(default_factory=list)


class MessageRead(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    attachments: list[AttachmentPayload] = Field(default_factory=list)
    created_at: int
    streaming: bool = False
    feedback: Literal["like", "dislike"] | None = None


class ThreadRead(BaseModel):
    id: str
    title: str
    created_at: int
    updated_at: int
    messages: list[MessageRead] = Field(default_factory=list)


class ThreadCreate(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=255)


class ThreadUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class EmailVerificationRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    full_name: str = Field(default="", max_length=255)


class EmailSignUpVerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class EmailSignInRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class UserRead(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    avatar_url: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class VerificationStartResponse(BaseModel):
    message: str
    expires_in_seconds: int


class ChatRequest(BaseModel):
    thread_id: str | None = None
    content: str = Field(default="", max_length=12000)
    attachments: list[AttachmentPayload] = Field(default_factory=list)
    model: str | None = None
    skills: list[str] = Field(default_factory=list)
    skill_configs: dict[str, str] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    thread: ThreadRead
    assistant_message_id: str


class FeedbackRequest(BaseModel):
    feedback: Literal["like", "dislike"] | None = None


class RegenerateRequest(BaseModel):
    thread_id: str
    assistant_message_id: str
    model: str | None = None
    skills: list[str] = Field(default_factory=list)
    skill_configs: dict[str, str] = Field(default_factory=dict)


class EditMessageRequest(BaseModel):
    thread_id: str
    user_message_id: str
    content: str = Field(min_length=1, max_length=12000)
    model: str | None = None
    skills: list[str] = Field(default_factory=list)
    skill_configs: dict[str, str] = Field(default_factory=dict)


class VoiceReplyRequest(BaseModel):
    user_prompt: str = Field(default="", max_length=12000)
    assistant_response: str = Field(default="", max_length=50000)
    model: str | None = None
    max_full_text_chars: int = Field(default=220, ge=40, le=1000)
    max_summary_chars: int = Field(default=120, ge=20, le=400)


class VoiceReplyResponse(BaseModel):
    mode: Literal["full", "summary"]
    speak_text: str


def datetime_to_epoch_ms(value: datetime) -> int:
    return int(value.timestamp() * 1000)
