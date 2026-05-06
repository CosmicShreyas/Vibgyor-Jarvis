from __future__ import annotations

import hashlib
import json
import re
import secrets
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import Any
from urllib.parse import quote
from uuid import uuid4

import httpx
from fastapi import HTTPException, status
from ollama import Client
from pymongo import ReturnDocument
from pymongo.database import Database

from app.config import get_settings
from app.schemas import AttachmentPayload, MessageRead, ThreadRead, UserRead, datetime_to_epoch_ms
from app.skills import generate_skill_reply, stream_skill_reply

settings = get_settings()
THREAD_TITLE_PREVIEW_LENGTH = 120
THREAD_HEADER_DISPLAY_LENGTH = 40
THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
MARKDOWN_DECORATION_RE = re.compile(r"[*_`>#]")
TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$", re.MULTILINE)


def now_utc() -> datetime:
    return datetime.utcnow()


def new_id() -> str:
    return str(uuid4())


def serialize_user(user: dict[str, Any]) -> UserRead:
    return UserRead(
        id=user["id"],
        email=user["email"],
        full_name=user.get("full_name", ""),
        avatar_url=user.get("avatar_url"),
    )


def attachment_preview_to_ollama_image(preview: str | None) -> str | None:
    if not preview or not preview.startswith("data:image/"):
        return None
    if "," not in preview:
        return None
    return preview.split(",", 1)[1].strip() or None


def message_to_ollama_payload(message: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "role": message["role"],
        "content": message.get("content", ""),
    }
    image_payloads = [
        encoded
        for encoded in (
            attachment_preview_to_ollama_image(attachment.get("preview"))
            for attachment in message.get("attachments", [])
            if isinstance(attachment, dict)
        )
        if encoded
    ]
    if image_payloads:
        payload["images"] = image_payloads
    return payload


def serialize_message(message: dict[str, Any]) -> MessageRead:
    attachments = message.get("attachments", [])
    return MessageRead(
        id=message["id"],
        role=message["role"],
        content=message.get("content", ""),
        attachments=[AttachmentPayload.model_validate(item) for item in attachments],
        created_at=datetime_to_epoch_ms(message["created_at"]),
        streaming=False,
        feedback=message.get("feedback"),
    )


def load_thread_messages(db: Database, thread_id: str) -> list[dict[str, Any]]:
    return list(db.messages.find({"thread_id": thread_id}).sort("created_at", 1))


def serialize_thread(db: Database, thread: dict[str, Any]) -> ThreadRead:
    return ThreadRead(
        id=thread["id"],
        title=thread["title"],
        created_at=datetime_to_epoch_ms(thread["created_at"]),
        updated_at=datetime_to_epoch_ms(thread["updated_at"]),
        messages=[serialize_message(message) for message in load_thread_messages(db, thread["id"])],
    )


def get_thread_or_404(db: Database, thread_id: str, owner_id: str) -> dict[str, Any]:
    thread = db.threads.find_one({"id": thread_id, "owner_id": owner_id})
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    return thread


def get_or_create_thread(
    db: Database,
    owner: UserRead,
    thread_id: str | None,
    initial_title: str,
) -> dict[str, Any]:
    if thread_id:
        return get_thread_or_404(db, thread_id, owner.id)

    timestamp = now_utc()
    thread = {
        "id": new_id(),
        "owner_id": owner.id,
        "title": initial_title[:THREAD_TITLE_PREVIEW_LENGTH] or "New conversation",
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    db.threads.insert_one(thread)
    return thread


def build_system_prompt() -> str:
    return (
        "You are Jarvis, an AI assistant for Vibgyor, an interior design company. "
        "Be practical, concise, and operationally useful. When design advice depends on "
        "measurements, constraints, cost, safety, or building standards, say so clearly."
    )


def strip_thinking_blocks(value: str) -> str:
    return THINK_BLOCK_RE.sub("", value or "").strip()


def markdown_to_voice_text(value: str) -> str:
    cleaned = strip_thinking_blocks(value)
    cleaned = MARKDOWN_LINK_RE.sub(r"\1", cleaned)
    cleaned = cleaned.replace("\r", "\n")
    cleaned = re.sub(r"```.*?```", " detailed code block omitted ", cleaned, flags=re.DOTALL)
    cleaned = TABLE_ROW_RE.sub(" detailed table available in chat ", cleaned)
    cleaned = re.sub(r"^\s*[-*]\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*\d+\.\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = MARKDOWN_DECORATION_RE.sub("", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def should_speak_full_response(text: str, max_chars: int) -> bool:
    if not text or len(text) > max_chars:
        return False
    if text.count("\n") > 4:
        return False
    if "|" in text or "```" in text:
        return False
    if re.search(r"(?im)^\s*(total|subtotal|calculation breakdown|matched specification)\b", text):
        return False
    return True


def generate_voice_reply_text(
    *,
    user_prompt: str,
    assistant_response: str,
    max_full_text_chars: int = 220,
    max_summary_chars: int = 120,
    model: str | None = None,
) -> tuple[str, str]:
    spoken_candidate = markdown_to_voice_text(assistant_response)
    if should_speak_full_response(spoken_candidate, max_full_text_chars):
        return "full", spoken_candidate

    fallback = "Great, I have done this work and you can see the detailed answer in the chat."
    client = Client(host=settings.ollama_base_url)
    response = client.chat(
        model=model or settings.ollama_model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are writing a spoken follow-up for a voice assistant. "
                    "The detailed answer is already visible in chat. "
                    f"Return exactly one natural sentence under {max_summary_chars} characters. "
                    "Do not read out calculations, tables, bullet lists, or long measurements. "
                    "Keep it warm, concise, and useful. Return plain text only."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"User request:\n{user_prompt.strip()}\n\n"
                    f"Detailed assistant response:\n{strip_thinking_blocks(assistant_response).strip()}"
                ),
            },
        ],
    )
    content = response.message.content.strip() if response.message and response.message.content else ""
    summary = markdown_to_voice_text(content)[:max_summary_chars].strip(" -:,.")
    if not summary:
        summary = fallback
    return "summary", summary


def generate_thread_title(
    source_text: str,
    assistant_text: str = "",
    model: str | None = None,
) -> str:
    combined_source = "\n\n".join(part.strip() for part in [source_text, assistant_text] if part.strip())
    fallback = source_text.strip()[:THREAD_TITLE_PREVIEW_LENGTH] or "New conversation"
    if not combined_source.strip():
        return fallback

    client = Client(host=settings.ollama_base_url)
    response = client.chat(
        model=model or settings.ollama_model,
        messages=[
            {
                "role": "system",
                "content": (
                    "Write a concise subject-style chat title for this conversation. "
                    "Use the user's request and the assistant's actual subject matter. "
                    "Return only the title text, no quotes, no markdown, maximum 6 words."
                ),
            },
            {"role": "user", "content": combined_source},
        ],
    )
    content = response.message.content.strip() if response.message and response.message.content else ""
    title = " ".join(content.replace("\n", " ").split()).strip(" -:|\"'")
    if not title:
        return fallback
    return title[:THREAD_TITLE_PREVIEW_LENGTH]


def message_history_for_ollama(db: Database, thread_id: str) -> list[dict[str, Any]]:
    return history_from_messages(load_thread_messages(db, thread_id))


def history_from_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    history: list[dict[str, Any]] = [{"role": "system", "content": build_system_prompt()}]
    for message in messages:
        history.append(message_to_ollama_payload(message))
    return history


def generate_assistant_reply(
    db: Database,
    thread_id: str,
    model: str | None = None,
    skills: list[str] | None = None,
    skill_configs: dict[str, str] | None = None,
) -> str:
    messages = load_thread_messages(db, thread_id)
    skill_reply = generate_skill_reply(
        db,
        messages,
        enabled_skills=skills,
        skill_configs=skill_configs,
        model=model or settings.ollama_model,
        ollama_base_url=settings.ollama_base_url,
    )
    if skill_reply:
        return skill_reply

    client = Client(host=settings.ollama_base_url)
    response = client.chat(
        model=model or settings.ollama_model,
        messages=history_from_messages(messages),
    )
    content = response.message.content if response.message else ""
    return content.strip() or "I couldn't generate a response just now. Please try again."


def stream_assistant_reply(
    db: Database,
    thread_id: str,
    model: str | None = None,
    skills: list[str] | None = None,
    skill_configs: dict[str, str] | None = None,
):
    messages = load_thread_messages(db, thread_id)
    skill_stream = stream_skill_reply(
        db,
        messages,
        enabled_skills=skills,
        skill_configs=skill_configs,
        model=model or settings.ollama_model,
        ollama_base_url=settings.ollama_base_url,
    )
    if skill_stream:
        yield from skill_stream
        return

    client = Client(host=settings.ollama_base_url)
    stream = client.chat(
        model=model or settings.ollama_model,
        messages=history_from_messages(messages),
        stream=True,
    )
    for chunk in stream:
        content = ""
        if getattr(chunk, "message", None):
            content = chunk.message.content or ""
        elif isinstance(chunk, dict):
            content = chunk.get("message", {}).get("content", "")
        if content:
            yield content


def stream_assistant_reply_from_history(
    messages: list[dict[str, Any]],
    model: str | None = None,
    skills: list[str] | None = None,
    skill_configs: dict[str, str] | None = None,
):
    skill_stream = stream_skill_reply(
        db,
        messages,
        enabled_skills=skills,
        skill_configs=skill_configs,
        model=model or settings.ollama_model,
        ollama_base_url=settings.ollama_base_url,
    )
    if skill_stream:
        yield from skill_stream
        return

    client = Client(host=settings.ollama_base_url)
    stream = client.chat(
        model=model or settings.ollama_model,
        messages=history_from_messages(messages),
        stream=True,
    )
    for chunk in stream:
        content = ""
        if getattr(chunk, "message", None):
            content = chunk.message.content or ""
        elif isinstance(chunk, dict):
            content = chunk.get("message", {}).get("content", "")
        if content:
            yield content


def json_line(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


async def exchange_google_code(code: str) -> dict[str, Any]:
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is not configured",
        )

    async with httpx.AsyncClient(timeout=20) as client:
        token_response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        token_response.raise_for_status()
        token_payload = token_response.json()

        userinfo_response = await client.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {token_payload['access_token']}"},
        )
        userinfo_response.raise_for_status()
        return userinfo_response.json()


def build_google_login_url(state: str = "") -> str:
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is not configured",
        )

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
    }
    if state:
        params["state"] = state

    query = "&".join(f"{key}={quote(str(value), safe='')}" for key, value in params.items())
    return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"


def generate_verification_code() -> str:
    return f"{secrets.randbelow(10**6):06d}"


def hash_verification_code(email: str, code: str) -> str:
    return hashlib.sha256(f"{email.lower()}:{code}:{settings.secret_key}".encode("utf-8")).hexdigest()


def build_verification_email_html(code: str, email: str) -> str:
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f2eb;color:#1f1d18;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <div style="background:radial-gradient(circle at top, rgba(31,29,24,0.07), rgba(246,242,235,0) 65%);border-radius:28px;padding:1px;">
        <div style="background:#fcfaf6;border:1px solid rgba(31,29,24,0.08);border-radius:28px;padding:36px 32px;box-shadow:0 16px 48px rgba(31,29,24,0.08);">
          <div style="width:48px;height:48px;border-radius:18px;background:#1f1d18;color:#fcfaf6;font-family:'Instrument Serif',Georgia,serif;font-size:28px;line-height:48px;text-align:center;vertical-align:middle;margin-bottom:24px;">O</div>
          <div style="font-family:'Instrument Serif',Georgia,serif;font-size:38px;line-height:1.05;letter-spacing:-0.03em;margin-bottom:12px;">
            Confirm your email
          </div>
          <div style="font-size:15px;line-height:1.7;color:#5e5a50;margin-bottom:28px;">
            Use the verification code below to finish creating your Jarvis account for <span style="color:#1f1d18;">{email}</span>.
          </div>
          <div style="border:1px solid rgba(31,29,24,0.08);background:#f4efe6;border-radius:22px;padding:20px 24px;text-align:center;margin-bottom:22px;">
            <div style="font-size:12px;letter-spacing:0.24em;text-transform:uppercase;color:#7b766b;margin-bottom:10px;">Verification code</div>
            <div style="font-size:36px;font-weight:700;letter-spacing:0.3em;color:#1f1d18;">{code}</div>
          </div>
          <div style="font-size:13px;line-height:1.7;color:#7b766b;">
            This code expires in {settings.signup_code_expire_minutes} minutes. If you didn’t request this, you can safely ignore this email.
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
"""


def send_verification_email(email: str, code: str) -> None:
    if not settings.smtp_username or not settings.smtp_password or not settings.smtp_from_email:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email delivery is not configured",
        )

    message = EmailMessage()
    message["Subject"] = "Your Jarvis verification code"
    message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
    message["To"] = email
    message.set_content(f"Your Jarvis verification code is {code}. It expires in {settings.signup_code_expire_minutes} minutes.")
    message.add_alternative(build_verification_email_html(code, email), subtype="html")

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
            smtp.starttls()
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    except Exception as exc:  # pragma: no cover - network dependent
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to send verification email",
        ) from exc


def upsert_signup_verification(
    db: Database,
    *,
    email: str,
    full_name: str,
    hashed_password: str,
    code: str,
) -> None:
    timestamp = now_utc()
    expires_at = timestamp + timedelta(minutes=settings.signup_code_expire_minutes)
    db.signup_verifications.find_one_and_update(
        {"email": email.lower()},
        {
            "$set": {
                "email": email.lower(),
                "full_name": full_name.strip() or email.split("@")[0],
                "hashed_password": hashed_password,
                "code_hash": hash_verification_code(email, code),
                "expires_at": expires_at,
                "updated_at": timestamp,
                "attempts": 0,
            },
            "$setOnInsert": {"id": new_id(), "created_at": timestamp},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )


def create_user_document(
    *,
    email: str,
    full_name: str,
    hashed_password: str | None = None,
    google_sub: str | None = None,
    avatar_url: str | None = None,
) -> dict[str, Any]:
    timestamp = now_utc()
    return {
        "id": new_id(),
        "email": email.lower(),
        "full_name": full_name.strip() or email.split("@")[0],
        "hashed_password": hashed_password,
        "google_sub": google_sub,
        "avatar_url": avatar_url,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
