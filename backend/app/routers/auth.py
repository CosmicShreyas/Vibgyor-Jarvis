from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pymongo.database import Database

from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user
from app.schemas import (
    EmailSignInRequest,
    EmailSignUpVerifyRequest,
    EmailVerificationRequest,
    TokenResponse,
    UserRead,
    VerificationStartResponse,
)
from app.security import create_access_token, hash_password, verify_password
from app.services import (
    build_google_login_url,
    create_user_document,
    exchange_google_code,
    generate_verification_code,
    send_verification_email,
    serialize_user,
    upsert_signup_verification,
    hash_verification_code,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


def normalize_redirect_target(target: str | None) -> str:
    default = f"{settings.frontend_url}/login"
    if not target:
        return default
    cleaned = target.strip()
    if cleaned.startswith(settings.frontend_url):
        return cleaned
    return default


@router.post(
    "/email/request-code",
    response_model=VerificationStartResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def request_signup_code(
    payload: EmailVerificationRequest,
    db: Database = Depends(get_db),
) -> VerificationStartResponse:
    email = payload.email.lower()
    existing = db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    code = generate_verification_code()
    upsert_signup_verification(
        db,
        email=email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        code=code,
    )
    send_verification_email(email, code)
    return VerificationStartResponse(
        message="Verification code sent",
        expires_in_seconds=settings.signup_code_expire_minutes * 60,
    )


@router.post("/email/verify-signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def verify_signup_code(
    payload: EmailSignUpVerifyRequest,
    db: Database = Depends(get_db),
) -> TokenResponse:
    email = payload.email.lower()
    verification = db.signup_verifications.find_one({"email": email})
    if not verification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No verification request found")

    if verification["expires_at"] < datetime.utcnow():
        db.signup_verifications.delete_one({"email": email})
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Verification code expired")

    expected = verification.get("code_hash")
    actual = hash_verification_code(email, payload.code)
    if expected != actual:
        db.signup_verifications.update_one({"email": email}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid verification code")

    if db.users.find_one({"email": email}):
        db.signup_verifications.delete_one({"email": email})
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = create_user_document(
        email=email,
        full_name=verification.get("full_name", ""),
        hashed_password=verification.get("hashed_password"),
    )
    db.users.insert_one(user)
    db.signup_verifications.delete_one({"email": email})
    return TokenResponse(access_token=create_access_token(user["id"]), user=serialize_user(user))


@router.post("/email/signin", response_model=TokenResponse)
def email_signin(payload: EmailSignInRequest, db: Database = Depends(get_db)) -> TokenResponse:
    user = db.users.find_one({"email": payload.email.lower()})
    if not user or not verify_password(payload.password, user.get("hashed_password")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    return TokenResponse(access_token=create_access_token(user["id"]), user=serialize_user(user))


@router.get("/google/login")
def google_login(redirect_to: str | None = Query(default=None)) -> RedirectResponse:
    state = normalize_redirect_target(redirect_to)
    return RedirectResponse(url=build_google_login_url(state=state), status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@router.get("/google/callback")
async def google_callback(
    code: str,
    state: str | None = None,
    db: Database = Depends(get_db),
) -> RedirectResponse:
    profile = await exchange_google_code(code)
    email = str(profile.get("email", "")).lower().strip()
    sub = str(profile.get("sub", "")).strip()
    if not email or not sub:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google profile is incomplete")

    user = db.users.find_one({"$or": [{"google_sub": sub}, {"email": email}]})
    if user:
        db.users.update_one(
            {"id": user["id"]},
            {
                "$set": {
                    "google_sub": user.get("google_sub") or sub,
                    "full_name": str(profile.get("name") or user.get("full_name") or email.split("@")[0]),
                    "avatar_url": str(profile.get("picture") or user.get("avatar_url") or ""),
                    "updated_at": datetime.utcnow(),
                }
            },
        )
        user = db.users.find_one({"id": user["id"]})
    else:
        user = create_user_document(
            email=email,
            full_name=str(profile.get("name") or email.split("@")[0]),
            google_sub=sub,
            avatar_url=str(profile.get("picture") or ""),
        )
        db.users.insert_one(user)

    token = create_access_token(user["id"])
    redirect_base = normalize_redirect_target(state)
    separator = "&" if "?" in redirect_base else "?"
    return RedirectResponse(url=f"{redirect_base}{separator}token={token}", status_code=status.HTTP_302_FOUND)


@router.get("/me", response_model=UserRead)
def read_me(current_user: UserRead = Depends(get_current_user)) -> UserRead:
    return current_user
