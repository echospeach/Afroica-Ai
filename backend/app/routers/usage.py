import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import DailyUsage, SearchUsage, User
from ..plans import daily_limit_for, is_pro
from ..schemas import UsageOut

router = APIRouter(prefix="/usage", tags=["usage"])


def _today() -> dt.date:
    return dt.datetime.now(dt.timezone.utc).date()


def _get_or_create_usage(db: Session, user_id: int, date: dt.date) -> DailyUsage:
    row = (
        db.query(DailyUsage)
        .filter(DailyUsage.user_id == user_id, DailyUsage.date == date)
        .first()
    )
    if row is None:
        row = DailyUsage(user_id=user_id, date=date, count=0)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _get_or_create_search_usage(db: Session, user_id: int, date: dt.date) -> SearchUsage:
    row = (
        db.query(SearchUsage)
        .filter(SearchUsage.user_id == user_id, SearchUsage.date == date)
        .first()
    )
    if row is None:
        row = SearchUsage(user_id=user_id, date=date, count=0)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _to_usage_out(user: User, row: DailyUsage) -> UsageOut:
    limit = daily_limit_for(user.subscription)
    return UsageOut(
        date=row.date.isoformat(),
        count=row.count,
        limit=limit,
        is_pro=is_pro(user.subscription),
        remaining=max(0, limit - row.count),
    )


@router.get("/me", response_model=UsageOut)
def usage_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _get_or_create_usage(db, user.id, _today())
    return _to_usage_out(user, row)


@router.post("/increment", response_model=UsageOut)
def usage_increment(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Called by the free-tier client-side path before it lets the on-device
    model answer, so the daily cap is enforced server-side (survives
    clearing browser storage) even though the actual inference is free/local."""
    row = _get_or_create_usage(db, user.id, _today())
    limit = daily_limit_for(user.subscription)

    if row.count >= limit:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "Daily message limit reached. Upgrade to Pro for unlimited messages.",
        )

    row.count += 1
    db.commit()
    db.refresh(row)
    return _to_usage_out(user, row)
