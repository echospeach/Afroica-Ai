import os


def test_admin_login_succeeds_with_correct_credentials(client):
    resp = client.post(
        "/admin/auth/login",
        json={"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]},
    )
    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_admin_login_rejects_wrong_password(client):
    resp = client.post(
        "/admin/auth/login",
        json={"email": os.environ["ADMIN_EMAIL"], "password": "not-the-password"},
    )
    assert resp.status_code == 401


def test_admin_login_rejects_wrong_email(client):
    resp = client.post(
        "/admin/auth/login",
        json={"email": "someone-else@example.com", "password": os.environ["ADMIN_PASSWORD"]},
    )
    assert resp.status_code == 401


def test_admin_routes_require_auth(client):
    assert client.get("/admin/stats").status_code == 401
    assert client.get("/admin/users").status_code == 401


def test_regular_user_token_cannot_access_admin_routes(client, auth_headers):
    # Proves the isolation: a normal user JWT is signed with a different
    # secret and lacks the role claim, so it must be rejected here too.
    resp = client.get("/admin/stats", headers=auth_headers)
    assert resp.status_code == 401


def test_admin_token_cannot_access_user_routes(client, admin_auth_headers):
    resp = client.get("/auth/me", headers=admin_auth_headers)
    assert resp.status_code == 401


def test_admin_stats_reflects_seeded_users(client, admin_auth_headers, monkeypatch):
    # Two free users, one Pro (monthly) user with some usage today.
    client.post("/auth/signup", json={"email": "free1@example.com", "password": "hunter22"})
    client.post("/auth/signup", json={"email": "free2@example.com", "password": "hunter22"})
    pro_signup = client.post(
        "/auth/signup", json={"email": "pro@example.com", "password": "hunter22"}
    )
    pro_user_id = pro_signup.json() and client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {pro_signup.json()['access_token']}"},
    ).json()["id"]

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

    def stripe_sig(payload: bytes) -> str:
        timestamp = int(time.time())
        signed = f"{timestamp}.{payload.decode('utf-8')}"
        sig = hmac.new(
            app_settings.stripe_webhook_secret.encode("utf-8"), signed.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return f"t={timestamp},v1={sig}"

    event = {
        "id": "evt_admin_test",
        "object": "event",
        "api_version": "2023-10-16",
        "created": 1700000000,
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "client_reference_id": str(pro_user_id),
                "customer": "cus_admin_test",
                "subscription": "sub_admin_test",
            }
        },
    }
    payload = json.dumps(event).encode("utf-8")
    client.post(
        "/billing/webhook",
        content=payload,
        headers={"stripe-signature": stripe_sig(payload), "content-type": "application/json"},
    )

    resp = client.get("/admin/stats", headers=admin_auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_users"] == 3
    assert body["pro_monthly"] == 1
    assert body["free_users"] == 2
    assert body["estimated_mrr"] == 6.99


def test_admin_users_lists_and_searches(client, admin_auth_headers):
    client.post("/auth/signup", json={"email": "alice@example.com", "password": "hunter22"})
    client.post("/auth/signup", json={"email": "bob@example.com", "password": "hunter22"})

    resp = client.get("/admin/users", headers=admin_auth_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 2

    resp = client.get("/admin/users", headers=admin_auth_headers, params={"search": "alice"})
    assert resp.json()["total"] == 1
    assert resp.json()["users"][0]["email"] == "alice@example.com"
    assert resp.json()["users"][0]["plan"] == "free"


def _signup(client, email):
    signup = client.post("/auth/signup", json={"email": email, "password": "hunter22"})
    headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
    user_id = client.get("/auth/me", headers=headers).json()["id"]
    return user_id, headers


def test_admin_user_detail_404_for_unknown_user(client, admin_auth_headers):
    resp = client.get("/admin/users/999999", headers=admin_auth_headers)
    assert resp.status_code == 404


def test_admin_user_detail_requires_admin_auth(client, auth_headers):
    me = client.get("/auth/me", headers=auth_headers).json()
    resp = client.get(f"/admin/users/{me['id']}", headers=auth_headers)
    assert resp.status_code == 401


def test_admin_user_detail_aggregates_usage_history(client, admin_auth_headers):
    user_id, user_headers = _signup(client, "carol@example.com")
    for _ in range(3):
        client.post("/usage/increment", headers=user_headers)

    resp = client.get(f"/admin/users/{user_id}", headers=admin_auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "carol@example.com"
    assert body["plan"] == "free"
    assert body["total_messages"] == 3
    assert body["impersonation_count"] == 0
    assert body["last_impersonated_at"] is None
    today_entries = [d for d in body["usage_history"] if d["count"] == 3]
    assert len(today_entries) == 1


def test_impersonate_requires_admin_auth(client, auth_headers):
    me = client.get("/auth/me", headers=auth_headers).json()
    resp = client.post(f"/admin/users/{me['id']}/impersonate", headers=auth_headers)
    assert resp.status_code == 401


def test_impersonate_404_for_unknown_user(client, admin_auth_headers):
    resp = client.post("/admin/users/999999/impersonate", headers=admin_auth_headers)
    assert resp.status_code == 404


def test_impersonate_returns_a_working_user_token(client, admin_auth_headers):
    user_id, _ = _signup(client, "dave@example.com")

    resp = client.post(f"/admin/users/{user_id}/impersonate", headers=admin_auth_headers)
    assert resp.status_code == 200
    token = resp.json()["access_token"]

    from app.security import decode_access_token

    assert decode_access_token(token) == user_id

    # And it works as a real login for that user against a normal user route.
    me_resp = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == "dave@example.com"


def test_impersonate_is_logged_and_reflected_in_detail(client, admin_auth_headers):
    user_id, _ = _signup(client, "erin@example.com")

    client.post(f"/admin/users/{user_id}/impersonate", headers=admin_auth_headers)
    client.post(f"/admin/users/{user_id}/impersonate", headers=admin_auth_headers)

    resp = client.get(f"/admin/users/{user_id}", headers=admin_auth_headers)
    body = resp.json()
    assert body["impersonation_count"] == 2
    assert body["last_impersonated_at"] is not None
