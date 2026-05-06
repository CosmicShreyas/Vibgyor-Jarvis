from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pymongo.database import Database

from app.config import get_settings
from app.database import get_db
from app.security import decode_access_token
from app.services import serialize_user

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_v1_prefix}/auth/email/signin")


def get_current_user(db: Database = Depends(get_db), token: str = Depends(oauth2_scheme)):
    user_id = decode_access_token(token)
    user = db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return serialize_user(user)
