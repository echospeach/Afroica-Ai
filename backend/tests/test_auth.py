import re


def _extract_reset_token(body: str) -> str:
    match = re.search(r"reset_token=([\w-]+)", body)
    assert match, f"no reset_token found in: {body}"
    return match.group(1)


def test_signup_returns_token(client):
    resp = client.post("/auth/signup", json={"email": "a@example.com", "password": "hunter22"})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_signup_duplicate_email_rejected(client):
    client.post("/auth/signup", json={"email": "a@example.com", "password": "hunter22"})
    resp = client.post("/auth/signup", json={"email": "a@example.com", "password": "otherpass"})
    assert resp.status_code == 409


def test_login_wrong_password_rejected(client):
    client.post("/auth/signup", json={"email": "a@example.com", "password": "hunter22"})
    resp = client.post("/auth/login", json={"email": "a@example.com", "password": "wrong"})
    assert resp.status_code == 401


def test_login_correct_password_returns_token(client):
    client.post("/auth/signup", json={"email": "a@example.com", "password": "hunter22"})
    resp = client.post("/auth/login", json={"email": "a@example.com", "password": "hunter22"})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_me_requires_auth(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_me_returns_current_user(client, auth_headers):
    resp = client.get("/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "test@example.com"
    assert body["is_pro"] is False


def test_invalid_token_rejected(client):
    resp = client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 401


def test_delete_account_requires_auth(client):
    resp = client.request("DELETE", "/auth/me", json={"password": "hunter22"})
    assert resp.status_code == 401


def test_delete_account_wrong_password_rejected(client, auth_headers):
    resp = client.request(
        "DELETE", "/auth/me", json={"password": "wrong"}, headers=auth_headers
    )
    assert resp.status_code == 401
    # Account must still exist and be usable.
    assert client.get("/auth/me", headers=auth_headers).status_code == 200


def test_delete_account_removes_user(client, auth_headers):
    resp = client.request(
        "DELETE", "/auth/me", json={"password": "hunter22"}, headers=auth_headers
    )
    assert resp.status_code == 204

    # The old token no longer resolves to anyone.
    assert client.get("/auth/me", headers=auth_headers).status_code == 401
    # The email is free again.
    signup = client.post("/auth/signup", json={"email": "test@example.com", "password": "newpass1"})
    assert signup.status_code == 200


def test_delete_account_with_usage_history_succeeds(client, auth_headers):
    client.post("/usage/increment", headers=auth_headers)
    client.post("/usage/increment", headers=auth_headers)

    resp = client.request(
        "DELETE", "/auth/me", json={"password": "hunter22"}, headers=auth_headers
    )
    assert resp.status_code == 204


def test_delete_account_cancels_stripe_subscription(client, auth_headers, monkeypatch):
    canceled_ids = []
    monkeypatch.setattr(
        "app.routers.auth.stripe.Subscription.delete",
        lambda sub_id: canceled_ids.append(sub_id),
    )

    # Give this user an active subscription the same way the webhook does.
    monkeypatch.setattr(
        "app.routers.billing.stripe.Subscription.retrieve",
        lambda sub_id: {
            "status": "active",
            "items": {"data": [{"price": {"id": "price_monthly_dummy"}}]},
        },
    )
    import hashlib
    import hmac
    import json
    import time

    from app.config import settings as app_settings

    user_id = client.get("/auth/me", headers=auth_headers).json()["id"]

    def stripe_sig(payload: bytes) -> str:
        timestamp = int(time.time())
        signed = f"{timestamp}.{payload.decode('utf-8')}"
        sig = hmac.new(
            app_settings.stripe_webhook_secret.encode("utf-8"), signed.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return f"t={timestamp},v1={sig}"

    event = {
        "id": "evt_delete_test",
        "object": "event",
        "api_version": "2023-10-16",
        "created": 1700000000,
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "client_reference_id": str(user_id),
                "customer": "cus_delete_test",
                "subscription": "sub_delete_test",
            }
        },
    }
    payload = json.dumps(event).encode("utf-8")
    client.post(
        "/billing/webhook",
        content=payload,
        headers={"stripe-signature": stripe_sig(payload), "content-type": "application/json"},
    )

    resp = client.request(
        "DELETE", "/auth/me", json={"password": "hunter22"}, headers=auth_headers
    )
    assert resp.status_code == 204
    assert canceled_ids == ["sub_delete_test"]


def test_delete_account_succeeds_even_if_stripe_cancel_fails(client, auth_headers, monkeypatch):
    import stripe as stripe_module

    def raise_stripe_error(sub_id):
        raise stripe_module.error.StripeError("boom")

    monkeypatch.setattr("app.routers.auth.stripe.Subscription.delete", raise_stripe_error)
    monkeypatch.setattr(
        "app.routers.billing.stripe.Subscription.retrieve",
        lambda sub_id: {
            "status": "active",
            "items": {"data": [{"price": {"id": "price_monthly_dummy"}}]},
        },
    )
    import hashlib
    import hmac
    import json
    import time

    from app.config import settings as app_settings

    user_id = client.get("/auth/me", headers=auth_headers).json()["id"]

    def stripe_sig(payload: bytes) -> str:
        timestamp = int(time.time())
        signed = f"{timestamp}.{payload.decode('utf-8')}"
        sig = hmac.new(
            app_settings.stripe_webhook_secret.encode("utf-8"), signed.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return f"t={timestamp},v1={sig}"

    event = {
        "id": "evt_delete_test_2",
        "object": "event",
        "api_version": "2023-10-16",
        "created": 1700000000,
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "client_reference_id": str(user_id),
                "customer": "cus_delete_test_2",
                "subscription": "sub_delete_test_2",
            }
        },
    }
    payload = json.dumps(event).encode("utf-8")
    client.post(
        "/billing/webhook",
        content=payload,
        headers={"stripe-signature": stripe_sig(payload), "content-type": "application/json"},
    )

    resp = client.request(
        "DELETE", "/auth/me", json={"password": "hunter22"}, headers=auth_headers
    )
    assert resp.status_code == 204


def test_forgot_password_always_returns_204_even_for_unknown_email(client):
    resp = client.post("/auth/forgot-password", json={"email": "nobody@example.com"})
    assert resp.status_code == 204


def test_forgot_password_sends_email_for_existing_user(client, monkeypatch):
    client.post("/auth/signup", json={"email": "reset@example.com", "password": "hunter22"})

    sent = []
    monkeypatch.setattr(
        "app.routers.auth.send_email",
        lambda to, subject, body: sent.append((to, subject, body)),
    )

    resp = client.post("/auth/forgot-password", json={"email": "reset@example.com"})
    assert resp.status_code == 204
    assert len(sent) == 1
    assert sent[0][0] == "reset@example.com"
    assert "reset_token=" in sent[0][2]


def test_reset_password_with_valid_token_changes_password(client, monkeypatch):
    client.post("/auth/signup", json={"email": "reset2@example.com", "password": "oldpass1"})

    sent = []
    monkeypatch.setattr(
        "app.routers.auth.send_email",
        lambda to, subject, body: sent.append((to, subject, body)),
    )
    client.post("/auth/forgot-password", json={"email": "reset2@example.com"})
    token = _extract_reset_token(sent[0][2])

    resp = client.post("/auth/reset-password", json={"token": token, "password": "newpass12"})
    assert resp.status_code == 204

    assert (
        client.post("/auth/login", json={"email": "reset2@example.com", "password": "oldpass1"}).status_code
        == 401
    )
    assert (
        client.post("/auth/login", json={"email": "reset2@example.com", "password": "newpass12"}).status_code
        == 200
    )


def test_reset_password_token_is_single_use(client, monkeypatch):
    client.post("/auth/signup", json={"email": "reset3@example.com", "password": "oldpass1"})
    sent = []
    monkeypatch.setattr(
        "app.routers.auth.send_email",
        lambda to, subject, body: sent.append((to, subject, body)),
    )
    client.post("/auth/forgot-password", json={"email": "reset3@example.com"})
    token = _extract_reset_token(sent[0][2])

    first = client.post("/auth/reset-password", json={"token": token, "password": "newpass12"})
    assert first.status_code == 204
    second = client.post("/auth/reset-password", json={"token": token, "password": "another123"})
    assert second.status_code == 400


def test_reset_password_rejects_bogus_token(client):
    resp = client.post(
        "/auth/reset-password", json={"token": "not-a-real-token", "password": "newpass12"}
    )
    assert resp.status_code == 400


def test_forgot_password_invalidates_previous_token(client, monkeypatch):
    client.post("/auth/signup", json={"email": "reset4@example.com", "password": "oldpass1"})
    sent = []
    monkeypatch.setattr(
        "app.routers.auth.send_email",
        lambda to, subject, body: sent.append((to, subject, body)),
    )

    client.post("/auth/forgot-password", json={"email": "reset4@example.com"})
    first_token = _extract_reset_token(sent[0][2])

    client.post("/auth/forgot-password", json={"email": "reset4@example.com"})
    second_token = _extract_reset_token(sent[1][2])

    stale = client.post(
        "/auth/reset-password", json={"token": first_token, "password": "newpass12"}
    )
    assert stale.status_code == 400

    fresh = client.post(
        "/auth/reset-password", json={"token": second_token, "password": "newpass12"}
    )
    assert fresh.status_code == 204
