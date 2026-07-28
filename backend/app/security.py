import datetime as dt
import hashlib
import secrets

import bcrypt
import jwt

from .config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(user_id: int) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + dt.timedelta(days=settings.jwt_expire_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> int:
    """Returns the user id encoded in the token. Raises jwt.PyJWTError on any
    invalid/expired/tampered token — callers turn that into a 401."""
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    return int(payload["sub"])


def create_admin_token() -> str:
    """Signed with ADMIN_JWT_SECRET (never JWT_SECRET) and carries a
    role claim, so a regular user token can never pass decode_admin_token
    even if somehow presented to an admin route."""
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": "admin",
        "role": "admin",
        "iat": now,
        "exp": now + dt.timedelta(days=settings.admin_jwt_expire_days),
    }
    return jwt.encode(payload, settings.admin_jwt_secret, algorithm=settings.jwt_algorithm)


def decode_admin_token(token: str) -> None:
    """Raises jwt.PyJWTError on any invalid/expired/tampered/wrong-role
    token — callers turn that into a 401."""
    payload = jwt.decode(token, settings.admin_jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("role") != "admin":
        raise jwt.InvalidTokenError("not an admin token")


def generate_reset_token() -> str:
    """256 bits of entropy — the raw value is what goes in the emailed
    link; only its hash (see hash_reset_token) is ever stored."""
    return secrets.token_urlsafe(32)


def hash_reset_token(token: str) -> str:
    # SHA-256, not bcrypt: this hashes a high-entropy random token, not a
    # human-chosen password, so bcrypt's deliberate slowness buys nothing
    # here — a fast hash is fine, and lets lookup be a plain indexed
    # equality query (see routers/auth.py reset-password).
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
