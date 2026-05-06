from datetime import datetime

from fastapi import APIRouter, Depends, Response, status
from pymongo.database import Database

from app.database import get_db
from app.deps import get_current_user
from app.schemas import ThreadCreate, ThreadRead, ThreadUpdate, UserRead
from app.services import get_thread_or_404, new_id, now_utc, serialize_thread

router = APIRouter(prefix="/threads", tags=["threads"])


@router.get("", response_model=list[ThreadRead])
def list_threads(
    db: Database = Depends(get_db),
    current_user: UserRead = Depends(get_current_user),
) -> list[ThreadRead]:
    threads = list(db.threads.find({"owner_id": current_user.id}).sort("updated_at", -1))
    return [serialize_thread(db, thread) for thread in threads]


@router.post("", response_model=ThreadRead, status_code=status.HTTP_201_CREATED)
def create_thread(
    payload: ThreadCreate,
    db: Database = Depends(get_db),
    current_user: UserRead = Depends(get_current_user),
) -> ThreadRead:
    timestamp = now_utc()
    thread = {
        "id": new_id(),
        "owner_id": current_user.id,
        "title": payload.title.strip() or "New conversation",
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    db.threads.insert_one(thread)
    return serialize_thread(db, thread)


@router.patch("/{thread_id}", response_model=ThreadRead)
def rename_thread(
    thread_id: str,
    payload: ThreadUpdate,
    db: Database = Depends(get_db),
    current_user: UserRead = Depends(get_current_user),
) -> ThreadRead:
    db.threads.update_one(
        {"id": thread_id, "owner_id": current_user.id},
        {"$set": {"title": payload.title.strip(), "updated_at": datetime.utcnow()}},
    )
    return serialize_thread(db, get_thread_or_404(db, thread_id, current_user.id))


@router.delete("/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_thread(
    thread_id: str,
    db: Database = Depends(get_db),
    current_user: UserRead = Depends(get_current_user),
) -> Response:
    thread = get_thread_or_404(db, thread_id, current_user.id)
    db.threads.delete_one({"id": thread["id"]})
    db.messages.delete_many({"thread_id": thread["id"]})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
