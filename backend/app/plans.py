"""Single source of truth for pricing/limits — tune these numbers here,
not scattered through route handlers. See the README for how they were
picked (Haiku 4.5 unit economics vs subscription price)."""

from .config import settings
from .models import Subscription

FREE_DAILY_LIMIT = 15

# Pro is "unlimited" in the marketing sense, but still soft-capped so a
# leaked token (or an abusive script) can't run up an unbounded Anthropic
# bill. At claude-haiku-4-5 rates a message costs roughly $0.003-0.01
# (more with images), so worst case (this cap hit every day) costs about
# $9-15/month against a $6.99/mo subscription — still tight, but nowhere
# near the ~$45/month exposure the old 500/day cap allowed. Tune this
# against real usage data once you have paying subscribers.
PRO_DAILY_SOFT_CAP = 150

# Stateless chat APIs resend the full conversation on every message, so an
# unbounded history makes later messages in a long conversation cost more
# than earlier ones. Keep only the most recent N messages when calling
# Anthropic — see llm.py's _trim_history().
MAX_HISTORY_MESSAGES = 20

# claude-haiku-4-5: $1/$5 per MTok, vision-capable — cheap enough that even
# a heavy Pro user costs well under the subscription price at this cap.
CHAT_MODEL_ID = "claude-haiku-4-5"

# Numeric prices — the single source of truth Stripe's actual Price objects
# should match. Kept separate from the display strings below so the admin
# dashboard's MRR estimate can't silently drift from what's charged.
PRICE_MONTHLY_USD = 6.99
PRICE_YEARLY_USD = 59.99

PLANS = {
    "free": {
        "label": "Free",
        "price_display": "$0",
        "daily_limit": FREE_DAILY_LIMIT,
        "features": [
            f"{FREE_DAILY_LIMIT} messages/day",
            "Runs on your device (private, but slower)",
            "Voice input",
        ],
    },
    "monthly": {
        "label": "Pro Monthly",
        "price_display": f"${PRICE_MONTHLY_USD}/mo",
        "stripe_price_id": settings.stripe_price_monthly,
        "daily_limit": PRO_DAILY_SOFT_CAP,
        "features": [
            "Unlimited daily messages (fair-use capped)",
            "Fast server-side responses",
            "Image understanding",
        ],
    },
    "yearly": {
        "label": "Pro Yearly",
        "price_display": f"${PRICE_YEARLY_USD}/yr",
        "stripe_price_id": settings.stripe_price_yearly,
        "daily_limit": PRO_DAILY_SOFT_CAP,
        "features": [
            "Everything in Pro Monthly",
            "~2 months free vs. paying monthly",
        ],
    },
}

_ACTIVE_STATUSES = {"active", "trialing"}


def is_pro(subscription: Subscription | None) -> bool:
    return subscription is not None and subscription.status in _ACTIVE_STATUSES


def daily_limit_for(subscription: Subscription | None) -> int:
    return PRO_DAILY_SOFT_CAP if is_pro(subscription) else FREE_DAILY_LIMIT
