import hashlib
import hmac
import json
import time

from app.config import settings


def _stripe_signature(payload: bytes, secret: str) -> str:
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload.decode('utf-8')}"
    signature = hmac.new(
        secret.encode("utf-8"), signed_payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"t={timestamp},v1={signature}"


def _wrap_event(event_type: str, obj: dict) -> dict:
    """Real Stripe webhook deliveries are full Event envelopes — the
    installed stripe SDK's construct_event() inspects the top-level
    "object" field, so a bare {"type", "data"} dict (what a hand-written
    fixture would naturally look like) fails inside the SDK before our
    handler code even runs."""
    return {
        "id": "evt_test_1",
        "object": "event",
        "api_version": "2023-10-16",
        "created": 1700000000,
        "type": event_type,
        "data": {"object": obj},
    }


def _post_webhook(client, event: dict):
    payload = json.dumps(event).encode("utf-8")
    sig = _stripe_signature(payload, settings.stripe_webhook_secret)
    return client.post(
        "/billing/webhook",
        content=payload,
        headers={"stripe-signature": sig, "content-type": "application/json"},
    )


FAKE_SUB = {
    "status": "active",
    "items": {"data": [{"price": {"id": "price_monthly_dummy"}}]},
}


def test_webhook_rejects_bad_signature(client):
    payload = json.dumps({"type": "checkout.session.completed", "data": {"object": {}}}).encode()
    resp = client.post(
        "/billing/webhook",
        content=payload,
        headers={"stripe-signature": "t=1,v1=deadbeef"},
    )
    assert resp.status_code == 400


def test_checkout_completed_marks_user_pro(client, auth_headers, monkeypatch):
    user_id = client.get("/auth/me", headers=auth_headers).json()["id"]
    monkeypatch.setattr(
        "app.routers.billing.stripe.Subscription.retrieve", lambda sub_id: FAKE_SUB
    )

    event = _wrap_event(
        "checkout.session.completed",
        {
            "client_reference_id": str(user_id),
            "customer": "cus_123",
            "subscription": "sub_123",
        },
    )
    resp = _post_webhook(client, event)
    assert resp.status_code == 200
    assert client.get("/auth/me", headers=auth_headers).json()["is_pro"] is True


def test_subscription_deleted_marks_user_not_pro(client, auth_headers, monkeypatch):
    user_id = client.get("/auth/me", headers=auth_headers).json()["id"]
    monkeypatch.setattr(
        "app.routers.billing.stripe.Subscription.retrieve", lambda sub_id: FAKE_SUB
    )
    _post_webhook(
        client,
        _wrap_event(
            "checkout.session.completed",
            {
                "client_reference_id": str(user_id),
                "customer": "cus_123",
                "subscription": "sub_123",
            },
        ),
    )
    assert client.get("/auth/me", headers=auth_headers).json()["is_pro"] is True

    deleted_event = _wrap_event(
        "customer.subscription.deleted",
        {
            "id": "sub_123",
            "customer": "cus_123",
            "status": "canceled",
            "items": {"data": [{"price": {"id": "price_monthly_dummy"}}]},
            "metadata": {"user_id": str(user_id)},
        },
    )
    resp = _post_webhook(client, deleted_event)
    assert resp.status_code == 200
    assert client.get("/auth/me", headers=auth_headers).json()["is_pro"] is False


def test_webhook_is_idempotent_on_retry(client, auth_headers, monkeypatch):
    user_id = client.get("/auth/me", headers=auth_headers).json()["id"]
    monkeypatch.setattr(
        "app.routers.billing.stripe.Subscription.retrieve", lambda sub_id: FAKE_SUB
    )
    event = _wrap_event(
        "checkout.session.completed",
        {
            "client_reference_id": str(user_id),
            "customer": "cus_123",
            "subscription": "sub_123",
        },
    )
    first = _post_webhook(client, event)
    second = _post_webhook(client, event)  # simulates Stripe's at-least-once retry
    assert first.status_code == 200
    assert second.status_code == 200
    assert client.get("/auth/me", headers=auth_headers).json()["is_pro"] is True
