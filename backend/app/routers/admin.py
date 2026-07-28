import datetime as dt
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_admin
from ..models import DailyUsage, ImpersonationLog, Subscription, User
from ..plans import PRICE_MONTHLY_USD, PRICE_YEARLY_USD, daily_limit_for, is_pro
from ..rate_limit import rate_limit
from ..schemas import (
    AdminLoginRequest,
    AdminStatsOut,
    AdminUserDetailOut,
    AdminUserOut,
    AdminUsersOut,
    SignupDay,
    TokenResponse,
    UsageDay,
)
from ..security import create_access_token, create_admin_token, verify_password

router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger("afroica.admin")

SIGNUP_HISTORY_DAYS = 30
USAGE_HISTORY_DAYS = 60


@router.post(
    "/auth/login",
    response_model=TokenResponse,
    dependencies=[Depends(rate_limit(max_attempts=5, window_seconds=900))],
)
def admin_login(body: AdminLoginRequest):
    valid_email = bool(settings.admin_email) and body.email == settings.admin_email
    valid_password = bool(settings.admin_password_hash) and verify_password(
        body.password, settings.admin_password_hash
    )
    if not (valid_email and valid_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    return TokenResponse(access_token=create_admin_token())


@router.get("/stats", response_model=AdminStatsOut, dependencies=[Depends(get_current_admin)])
def admin_stats(db: Session = Depends(get_db)):
    users = db.query(User).all()
    subs_by_user = {s.user_id: s for s in db.query(Subscription).all()}

    total_users = len(users)
    pro_monthly = 0
    pro_yearly = 0
    for user in users:
        sub = subs_by_user.get(user.id)
        if is_pro(sub):
            if sub.plan == "yearly":
                pro_yearly += 1
            else:
                pro_monthly += 1
    free_users = total_users - pro_monthly - pro_yearly

    today = dt.datetime.now(dt.timezone.utc).date()
    messages_today = (
        db.query(func.coalesce(func.sum(DailyUsage.count), 0))
        .filter(DailyUsage.date == today)
        .scalar()
    )

    since = today - dt.timedelta(days=SIGNUP_HISTORY_DAYS)
    recent_signups = [u.created_at.date() for u in users if u.created_at.date() >= since]
    counts: dict[dt.date, int] = {}
    for d in recent_signups:
        counts[d] = counts.get(d, 0) + 1
    signups_by_day = [
        SignupDay(date=(since + dt.timedelta(days=i)).isoformat(), count=counts.get(since + dt.timedelta(days=i), 0))
        for i in range(SIGNUP_HISTORY_DAYS + 1)
    ]

    estimated_mrr = round(pro_monthly * PRICE_MONTHLY_USD + pro_yearly * (PRICE_YEARLY_USD / 12), 2)

    return AdminStatsOut(
        total_users=total_users,
        free_users=free_users,
        pro_monthly=pro_monthly,
        pro_yearly=pro_yearly,
        messages_today=int(messages_today),
        signups_by_day=signups_by_day,
        estimated_mrr=estimated_mrr,
    )


@router.get("/users", response_model=AdminUsersOut, dependencies=[Depends(get_current_admin)])
def admin_users(
    search: str = "",
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    query = db.query(User)
    if search:
        query = query.filter(User.email.ilike(f"%{search}%"))

    total = query.count()
    rows = query.order_by(User.created_at.desc()).offset(offset).limit(limit).all()

    today = dt.datetime.now(dt.timezone.utc).date()
    out = []
    for user in rows:
        sub = user.subscription
        plan = sub.plan if sub is not None else "free"
        sub_status = sub.status if sub is not None else "none"
        usage_row = (
            db.query(DailyUsage)
            .filter(DailyUsage.user_id == user.id, DailyUsage.date == today)
            .first()
        )
        out.append(
            AdminUserOut(
                id=user.id,
                email=user.email,
                created_at=user.created_at.isoformat(),
                plan=plan,
                subscription_status=sub_status,
                messages_today=usage_row.count if usage_row else 0,
                daily_limit=daily_limit_for(sub),
            )
        )

    return AdminUsersOut(users=out, total=total)


@router.get(
    "/users/{user_id}", response_model=AdminUserDetailOut, dependencies=[Depends(get_current_admin)]
)
def admin_user_detail(user_id: int, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    sub = user.subscription
    plan = sub.plan if sub is not None else "free"
    sub_status = sub.status if sub is not None else "none"
    limit = daily_limit_for(sub)

    since = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=USAGE_HISTORY_DAYS)
    usage_rows = (
        db.query(DailyUsage)
        .filter(DailyUsage.user_id == user.id, DailyUsage.date >= since)
        .order_by(DailyUsage.date)
        .all()
    )
    usage_history = [UsageDay(date=row.date.isoformat(), count=row.count, limit=limit) for row in usage_rows]
    total_messages = sum(row.count for row in usage_rows)

    impersonations = (
        db.query(ImpersonationLog)
        .filter(ImpersonationLog.user_id == user.id)
        .order_by(ImpersonationLog.created_at.desc())
        .all()
    )

    return AdminUserDetailOut(
        id=user.id,
        email=user.email,
        created_at=user.created_at.isoformat(),
        plan=plan,
        subscription_status=sub_status,
        current_period_end=sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
        stripe_customer_id=sub.stripe_customer_id if sub else None,
        total_messages=total_messages,
        usage_history=usage_history,
        impersonation_count=len(impersonations),
        last_impersonated_at=impersonations[0].created_at.isoformat() if impersonations else None,
    )


@router.post(
    "/users/{user_id}/impersonate", response_model=TokenResponse, dependencies=[Depends(get_current_admin)]
)
def admin_impersonate_user(user_id: int, db: Session = Depends(get_db)):
    """Issues a REAL user access token for the target account — indistinguishable
    from one issued by a normal login. This is deliberately powerful (that's the
    point: support/debugging without the user's password), so every call is
    logged both to the DB (visible in the user's detail view) and to the server
    log, and requires the same admin auth as every other /admin route."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    db.add(ImpersonationLog(user_id=user.id))
    db.commit()
    logger.warning("Admin impersonated user_id=%s (%s)", user.id, user.email)

    return TokenResponse(access_token=create_access_token(user.id))
