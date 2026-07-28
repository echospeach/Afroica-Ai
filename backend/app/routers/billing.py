import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import Subscription, User
from ..plans import PLANS
from ..schemas import CheckoutRequest, CheckoutResponse, PortalResponse

router = APIRouter(prefix="/billing", tags=["billing"])
logger = logging.getLogger("afroica.billing")

stripe.api_key = settings.stripe_secret_key


@router.post("/checkout", response_model=CheckoutResponse)
def create_checkout_session(
    body: CheckoutRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    price_id = PLANS[body.plan]["stripe_price_id"]
    if not price_id:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"Stripe price for the {body.plan} plan isn't configured yet.",
        )

    session = stripe.checkout.Session.create(
        mode="subscription",
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        client_reference_id=str(user.id),
        customer_email=user.email,
        subscription_data={"metadata": {"user_id": str(user.id)}},
        success_url=f"{settings.frontend_url}/?checkout=success",
        cancel_url=f"{settings.frontend_url}/?checkout=cancelled",
    )
    return CheckoutResponse(url=session.url)


@router.post("/portal", response_model=PortalResponse)
def create_portal_session(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if user.subscription is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No subscription to manage")

    session = stripe.billing_portal.Session.create(
        customer=user.subscription.stripe_customer_id,
        return_url=f"{settings.frontend_url}/",
    )
    return PortalResponse(url=session.url)


def _plan_from_price_id(price_id: str | None) -> str:
    for plan_key in ("monthly", "yearly"):
        if PLANS[plan_key]["stripe_price_id"] == price_id:
            return plan_key
    return "monthly"


def _upsert_subscription(
    db: Session,
    *,
    user_id: int | None,
    stripe_customer_id: str,
    stripe_subscription_id: str,
    status_: str,
    price_id: str | None,
    current_period_end,
) -> None:
    row = (
        db.query(Subscription)
        .filter(Subscription.stripe_subscription_id == stripe_subscription_id)
        .first()
    )
    if row is None:
        if user_id is None:
            # We have no way to attribute this subscription to a user —
            # log and skip rather than guessing.
            logger.warning(
                "Webhook for unknown subscription %s with no user_id; skipping",
                stripe_subscription_id,
            )
            return
        row = Subscription(
            user_id=user_id,
            stripe_customer_id=stripe_customer_id,
            stripe_subscription_id=stripe_subscription_id,
            status=status_,
            plan=_plan_from_price_id(price_id),
            current_period_end=current_period_end,
        )
        db.add(row)
    else:
        row.status = status_
        row.stripe_customer_id = stripe_customer_id
        if price_id:
            row.plan = _plan_from_price_id(price_id)
        row.current_period_end = current_period_end
    db.commit()


@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, settings.stripe_webhook_secret)
    except (ValueError, stripe.error.SignatureVerificationError) as err:
        # This used to fail silently — a mismatched STRIPE_WEBHOOK_SECRET
        # (e.g. `stripe listen` was restarted, which mints a new secret
        # every time, and .env wasn't updated to match) meant subscriptions
        # would just never activate with no visible error anywhere. Now at
        # least it's loud in the backend's own logs.
        logger.warning(
            "Stripe webhook rejected (bad signature or payload) — if this "
            "keeps happening, STRIPE_WEBHOOK_SECRET in .env probably "
            "doesn't match the currently-running `stripe listen` session: %s",
            err,
        )
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid webhook payload or signature")

    logger.info("Stripe webhook received: %s", event["type"])
    event_type = event["type"]
    # construct_event() returns nested StripeObject instances, which support
    # __getitem__ but NOT .get() (it raises AttributeError) — convert to a
    # plain dict so the .get() calls below work against both real Stripe
    # payloads and the plain-dict fixtures used in tests.
    obj = event["data"]["object"].to_dict()

    if event_type == "checkout.session.completed":
        user_id = int(obj["client_reference_id"]) if obj.get("client_reference_id") else None
        subscription_id = obj.get("subscription")
        if subscription_id:
            sub = stripe.Subscription.retrieve(subscription_id)
            price_id = sub["items"]["data"][0]["price"]["id"] if sub["items"]["data"] else None
            _upsert_subscription(
                db,
                user_id=user_id,
                stripe_customer_id=obj["customer"],
                stripe_subscription_id=subscription_id,
                status_=sub["status"],
                price_id=price_id,
                current_period_end=None,
            )

    elif event_type in ("customer.subscription.updated", "customer.subscription.deleted"):
        price_id = obj["items"]["data"][0]["price"]["id"] if obj.get("items", {}).get("data") else None
        metadata_user_id = obj.get("metadata", {}).get("user_id")
        _upsert_subscription(
            db,
            user_id=int(metadata_user_id) if metadata_user_id else None,
            stripe_customer_id=obj["customer"],
            stripe_subscription_id=obj["id"],
            status_=obj["status"],
            price_id=price_id,
            current_period_end=None,
        )

    return {"received": True}
