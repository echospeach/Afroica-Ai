import datetime as dt

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=lambda: dt.datetime.now(dt.timezone.utc)
    )

    subscription: Mapped["Subscription | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class DailyUsage(Base):
    """One row per (user, UTC date). `count` is the number of free-tier
    messages that user has sent that day — the enforcement point for the
    daily cap in plans.py."""

    __tablename__ = "daily_usage"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_daily_usage_user_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class SearchUsage(Base):
    """One row per (user, UTC date) — how many Claude web searches (Pro
    only, see plans.PRO_DAILY_SEARCH_CAP and routers/chat.py) that user has
    triggered that day. A separate table from DailyUsage rather than a new
    column on it: this project has no migration tooling, just
    Base.metadata.create_all() at startup, which creates missing tables
    but never alters existing ones — a new table ships safely to an
    already-running production database, a new column on an existing
    table would not."""

    __tablename__ = "search_usage"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_search_usage_user_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class Subscription(Base):
    """At most one row per user. `status` mirrors the Stripe subscription
    status string (active, trialing, past_due, canceled, ...) — only
    active/trialing are treated as "Pro" by plans.is_pro()."""

    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), unique=True, nullable=False, index=True
    )
    stripe_customer_id: Mapped[str] = mapped_column(String(255), nullable=False)
    stripe_subscription_id: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    plan: Mapped[str] = mapped_column(String(20), nullable=False)  # "monthly" | "yearly"
    current_period_end: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime,
        default=lambda: dt.datetime.now(dt.timezone.utc),
        onupdate=lambda: dt.datetime.now(dt.timezone.utc),
    )

    user: Mapped["User"] = relationship(back_populates="subscription")


class ImpersonationLog(Base):
    """One row per admin impersonation — the audit trail for a deliberately
    high-blast-radius feature (see routers/admin.py). No admin_id column:
    there is exactly one admin identity by design (deps.get_current_admin
    is env-var based, not a DB row)."""

    __tablename__ = "impersonation_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=lambda: dt.datetime.now(dt.timezone.utc)
    )


class PasswordResetToken(Base):
    """A single-use, time-limited token for the forgot-password flow.
    Stores a SHA-256 hash of the token, not the raw value — a DB leak
    shouldn't hand out working reset links. The raw token only ever exists
    in the email sent to the user and in-flight over HTTPS."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=lambda: dt.datetime.now(dt.timezone.utc)
    )
