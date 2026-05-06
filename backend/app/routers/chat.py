from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pymongo.database import Database

from app.database import get_db
from app.deps import get_current_user
from app.schemas import ChatRequest, ChatResponse, UserRead, VoiceReplyRequest, VoiceReplyResponse
from app.schemas import EditMessageRequest, FeedbackRequest, RegenerateRequest
from app.services import (
    THREAD_TITLE_PREVIEW_LENGTH,
    generate_assistant_reply,
    generate_thread_title,
    generate_voice_reply_text,
    get_or_create_thread,
    get_thread_or_404,
    json_line,
    load_thread_messages,
    new_id,
    now_utc,
    serialize_thread,
    stream_assistant_reply,
    stream_assistant_reply_from_history,
)

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/send", response_model=ChatResponse)
def send_chat_message(
    payload: ChatRequest,
    db: Database = Depends(get_db),
    current_user: UserRead = Depends(get_current_user),
) -> ChatResponse:
    thread = get_or_create_thread(db, current_user, payload.thread_id, payload.content)

    user_message = {
        "id": new_id(),
        "thread_id": thread["id"],
        "role": "user",
        "content": payload.content,
        "attachments": [item.model_dump() for item in payload.attachments],
        "created_at": now_utc(),
    }
    db.messages.insert_one(user_message)

    assistant_text = generate_assistant_reply(
        db,
        thread["id"],
        model=payload.model,
        skills=payload.skills,
        skill_configs=payload.skill_configs,
    )
    assistant_message = {
        "id": new_id(),
        "thread_id": thread["id"],
        "role": "assistant",
        "content": assistant_text,
        "attachments": [],
        "created_at": now_utc(),
    }
    db.messages.insert_one(assistant_message)

    next_title = thread["title"]
    if (not payload.thread_id or next_title == "New conversation") and payload.content.strip():
        next_title = generate_thread_title(payload.content, assistant_text, model=payload.model)

    db.threads.update_one(
        {"id": thread["id"], "owner_id": current_user.id},
        {"$set": {"title": next_title, "updated_at": datetime.utcnow()}},
    )
    thread = db.threads.find_one({"id": thread["id"], "owner_id": current_user.id})
    return ChatResponse(thread=serialize_thread(db, thread), assistant_message_id=assistant_message["id"])


@router.post("/stream")
def stream_chat_message(
    payload: ChatRequest,
    db: Database = Depends(get_db),
    current_user: UserRead = Depends(get_current_user),
) -> StreamingResponse:
    thread = get_or_create_thread(db, current_user, payload.thread_id, payload.content)

    user_message = {
        "id": new_id(),
        "thread_id": thread["id"],
        "role": "user",
        "content": payload.content,
        "attachments": [item.model_dump() for item in payload.attachments],
        "created_at": now_utc(),
    }
    db.messages.insert_one(user_message)

    def event_stream():
        assistant_parts: list[str] = []
        try:
            yield json_line({"type": "thread", "thread_id": thread["id"]})
            for delta in stream_assistant_reply(
                db,
                thread["id"],
                model=payload.model,
                skills=payload.skills,
                skill_configs=payload.skill_configs,
            ):
                assistant_parts.append(delta)
                yield json_line({"type": "delta", "delta": delta})

            assistant_text = "".join(assistant_parts).strip() or "I couldn't generate a response just now. Please try again."
            assistant_message = {
                "id": new_id(),
                "thread_id": thread["id"],
                "role": "assistant",
                "content": assistant_text,
                "attachments": [],
                "created_at": now_utc(),
            }
            db.messages.insert_one(assistant_message)

            next_title = thread["title"]
            if (not payload.thread_id or next_title == "New conversation") and payload.content.strip():
                next_title = generate_thread_title(payload.content, assistant_text, model=payload.model)

            db.threads.update_one(
                {"id": thread["id"], "owner_id": current_user.id},
                {"$set": {"title": next_title, "updated_at": datetime.utcnow()}},
            )
            persisted_thread = db.threads.find_one({"id": thread["id"], "owner_id": current_user.id})
            yield json_line(
                {
                    "type": "done",
                    "assistant_message_id": assistant_message["id"],
                    "thread": serialize_thread(db, persisted_thread).model_dump(),
                }
            )
        except Exception as exc:
            yield json_line({"type": "error", "error": str(exc)})

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.patch("/messages/{message_id}/feedback", response_model=ChatResponse)
def set_message_feedback(
    message_id: str,
    payload: FeedbackRequest,
    db: Database = Depends(get_db),
    current_user: UserRead = Depends(get_current_user),
) -> ChatResponse:
    message = db.messages.find_one({"id": message_id, "role": "assistant"})
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assistant message not found")
    thread = get_thread_or_404(db, message["thread_id"], current_user.id)
    db.messages.update_one(
        {"id": message_id},
        {"$set": {"feedback": payload.feedback}},
    )
    thread = db.threads.find_one({"id": thread["id"], "owner_id": current_user.id})
    return ChatResponse(thread=serialize_thread(db, thread), assistant_message_id=message_id)


@router.post("/regenerate-stream")
def regenerate_chat_message(
    payload: RegenerateRequest,
    db: Database = Depends(get_db),
    current_user: UserRead = Depends(get_current_user),
) -> StreamingResponse:
    thread = get_thread_or_404(db, payload.thread_id, current_user.id)
    messages = load_thread_messages(db, thread["id"])
    assistant_index = next(
        (index for index, message in enumerate(messages) if message["id"] == payload.assistant_message_id),
        None,
    )
    if assistant_index is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assistant message not found")

    history_messages = messages[:assistant_index]
    if not history_messages or history_messages[-1]["role"] != "user":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No user prompt found for regeneration")

    def event_stream():
        assistant_parts: list[str] = []
        try:
            yield json_line({"type": "thread", "thread_id": thread["id"]})
            for delta in stream_assistant_reply_from_history(
                history_messages,
                model=payload.model,
                skills=payload.skills,
                skill_configs=payload.skill_configs,
            ):
                assistant_parts.append(delta)
                yield json_line({"type": "delta", "delta": delta})

            assistant_text = "".join(assistant_parts).strip() or "I couldn't generate a response just now. Please try again."
            db.messages.update_one(
                {"id": payload.assistant_message_id, "thread_id": thread["id"], "role": "assistant"},
                {
                    "$set": {
                        "content": assistant_text,
                        "attachments": [],
                        "feedback": None,
                        "created_at": now_utc(),
                    }
                },
            )
            db.threads.update_one(
                {"id": thread["id"], "owner_id": current_user.id},
                {"$set": {"updated_at": datetime.utcnow()}},
            )
            persisted_thread = db.threads.find_one({"id": thread["id"], "owner_id": current_user.id})
            yield json_line(
                {
                    "type": "done",
                    "assistant_message_id": payload.assistant_message_id,
                    "thread": serialize_thread(db, persisted_thread).model_dump(),
                }
            )
        except Exception as exc:
            yield json_line({"type": "error", "error": str(exc)})

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/edit-stream")
def edit_chat_message(
    payload: EditMessageRequest,
    db: Database = Depends(get_db),
    current_user: UserRead = Depends(get_current_user),
) -> StreamingResponse:
    thread = get_thread_or_404(db, payload.thread_id, current_user.id)
    messages = load_thread_messages(db, thread["id"])
    user_index = next(
        (index for index, message in enumerate(messages) if message["id"] == payload.user_message_id),
        None,
    )
    if user_index is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User message not found")
    if messages[user_index]["role"] != "user":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only user messages can be edited")

    message_ids_to_remove = [message["id"] for message in messages[user_index + 1 :]]
    db.messages.update_one(
        {"id": payload.user_message_id, "thread_id": thread["id"], "role": "user"},
        {"$set": {"content": payload.content, "created_at": now_utc()}},
    )
    if message_ids_to_remove:
        db.messages.delete_many({"id": {"$in": message_ids_to_remove}})

    updated_messages = load_thread_messages(db, thread["id"])
    updated_index = next(
        (index for index, message in enumerate(updated_messages) if message["id"] == payload.user_message_id),
        None,
    )
    history_messages = updated_messages[: (updated_index or 0) + 1]

    def event_stream():
        assistant_parts: list[str] = []
        try:
            yield json_line({"type": "thread", "thread_id": thread["id"]})
            for delta in stream_assistant_reply_from_history(
                history_messages,
                model=payload.model,
                skills=payload.skills,
                skill_configs=payload.skill_configs,
            ):
                assistant_parts.append(delta)
                yield json_line({"type": "delta", "delta": delta})

            assistant_text = "".join(assistant_parts).strip() or "I couldn't generate a response just now. Please try again."
            assistant_message = {
                "id": new_id(),
                "thread_id": thread["id"],
                "role": "assistant",
                "content": assistant_text,
                "attachments": [],
                "created_at": now_utc(),
                "feedback": None,
            }
            db.messages.insert_one(assistant_message)

            next_title = thread["title"]
            if updated_messages and updated_messages[0]["id"] == payload.user_message_id:
                next_title = generate_thread_title(payload.content, assistant_text, model=payload.model)
            elif next_title == "New conversation" and payload.content.strip():
                next_title = generate_thread_title(payload.content, assistant_text, model=payload.model)

            db.threads.update_one(
                {"id": thread["id"], "owner_id": current_user.id},
                {"$set": {"title": next_title, "updated_at": datetime.utcnow()}},
            )
            persisted_thread = db.threads.find_one({"id": thread["id"], "owner_id": current_user.id})
            yield json_line(
                {
                    "type": "done",
                    "assistant_message_id": assistant_message["id"],
                    "thread": serialize_thread(db, persisted_thread).model_dump(),
                }
            )
        except Exception as exc:
            yield json_line({"type": "error", "error": str(exc)})

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/voice-brief", response_model=VoiceReplyResponse)
def generate_voice_brief(
    payload: VoiceReplyRequest,
    current_user: UserRead = Depends(get_current_user),
) -> VoiceReplyResponse:
    del current_user
    mode, speak_text = generate_voice_reply_text(
        user_prompt=payload.user_prompt,
        assistant_response=payload.assistant_response,
        max_full_text_chars=payload.max_full_text_chars,
        max_summary_chars=payload.max_summary_chars,
        model=payload.model,
    )
    return VoiceReplyResponse(mode=mode, speak_text=speak_text)
