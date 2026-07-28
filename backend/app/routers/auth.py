import datetime as dt
import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..email import send_email
from ..models import DailyUsage, ImpersonationLog, PasswordResetToken, SearchUsage, User
from ..plans import PLANS, is_pro
from ..rate_limit import rate_limit
from ..schemas import (
    DeleteAccountRequest,
    ForgotPasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
    SignupRequest,
    TokenResponse,
    UserOut,
)
from ..security import (
    create_access_token,
    generate_reset_token,
    hash_password,
    hash_reset_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("afroica.auth")

RESET_TOKEN_EXPIRE_HOURS = 1


@router.post(
    "/signup",
    response_model=TokenResponse,
    dependencies=[Depends(rate_limit(max_attempts=5, window_seconds=900))],
)
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == body.email).first()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists")

    user = User(email=body.email, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id))


@router.post(
    "/login",
    response_model=TokenResponse,
    dependencies=[Depends(rate_limit(max_attempts=10, window_seconds=900))],
)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    pro = is_pro(user.subscription)
    plan_label = PLANS[user.subscription.plan]["label"] if pro and user.subscription else None
    return UserOut(id=user.id, email=user.email, is_pro=pro, plan=plan_label)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    body: DeleteAccountRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Require the current password even though the request is already
    # authenticated — a stolen/leaked token alone shouldn't be enough to
    # destroy the account.
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect password")

    if user.subscription is not None:
        try:
            stripe.Subscription.delete(user.subscription.stripe_subscription_id)
        except stripe.error.StripeError as err:
            # Don't block deletion on a Stripe hiccup (already-canceled,
            # network blip, etc.) — but this needs a human to notice and
            # check Stripe directly, since the local record is about to
            # disappear along with the user.
            logger.warning(
                "Failed to cancel Stripe subscription %s while deleting user_id=%s: %s",
                user.subscription.stripe_subscription_id,
                user.id,
                err,
            )

    # DailyUsage, SearchUsage, and ImpersonationLog aren't ORM relationships
    # on User (no cascade configured), so they must be cleared explicitly —
    # SQLite doesn't enforce the FK by default, but Postgres in production
    # would reject the delete otherwise.
    db.query(DailyUsage).filter(DailyUsage.user_id == user.id).delete()
    db.query(SearchUsage).filter(SearchUsage.user_id == user.id).delete()
    db.query(ImpersonationLog).filter(ImpersonationLog.user_id == user.id).delete()
    db.delete(user)
    db.commit()


@router.post(
    "/forgot-password",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit(max_attempts=5, window_seconds=900))],
)
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Always returns 204 regardless of whether the email exists — telling
    an anonymous caller "no account with that email" is a user-enumeration
    leak. If it does exist, a reset email goes out (or gets logged to the
    console — see app/email.py — if no email provider is configured)."""
    user = db.query(User).filter(User.email == body.email).first()
    if user is not None:
        # Old outstanding tokens shouldn't stay valid once a new one is issued.
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None)
        ).update({"used_at": dt.datetime.now(dt.timezone.utc)})

        token = generate_reset_token()
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_reset_token(token),
                expires_at=dt.datetime.now(dt.timezone.utc)
                + dt.timedelta(hours=RESET_TOKEN_EXPIRE_HOURS),
            )
        )
        db.commit()

        reset_link = f"{settings.frontend_url}/?reset_token={token}"
        send_email(
            user.email,
            "Reset your Afroica AI password",
            f"Someone requested a password reset for this account.\n\n"
            f"Reset it here (expires in {RESET_TOKEN_EXPIRE_HOURS} hour): {reset_link}\n\n"
            f"If you didn't request this, you can safely ignore this email.",
        )


@router.post(
    "/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit(max_attempts=10, window_seconds=900))],
)
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    token_hash = hash_reset_token(body.token)
    reset_token = (
        db.query(PasswordResetToken).filter(PasswordResetToken.token_hash == token_hash).first()
    )

    now = dt.datetime.now(dt.timezone.utc)
    valid = (
        reset_token is not None
        and reset_token.used_at is None
        and reset_token.expires_at.replace(tzinfo=dt.timezone.utc) > now
    )
    if not valid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired reset link")

    user = db.get(User, reset_token.user_id)
    user.password_hash = hash_password(body.password)
    reset_token.used_at = now
    db.commit()
