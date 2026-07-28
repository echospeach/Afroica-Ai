import os


def test_login_rate_limited_after_too_many_attempts(client):
    for _ in range(10):
        client.post("/auth/login", json={"email": "nobody@example.com", "password": "wrong"})
    resp = client.post("/auth/login", json={"email": "nobody@example.com", "password": "wrong"})
    assert resp.status_code == 429


def test_signup_rate_limited_after_too_many_attempts(client):
    for i in range(5):
        client.post("/auth/signup", json={"email": f"spam{i}@example.com", "password": "hunter22"})
    resp = client.post("/auth/signup", json={"email": "spam-extra@example.com", "password": "hunter22"})
    assert resp.status_code == 429


def test_admin_login_rate_limited_after_too_many_attempts(client):
    for _ in range(5):
        client.post("/admin/auth/login", json={"email": "admin@example.com", "password": "wrong"})
    resp = client.post("/admin/auth/login", json={"email": "admin@example.com", "password": "wrong"})
    assert resp.status_code == 429


def test_rate_limit_is_per_route_not_global(client):
    # Exhausting the admin login limit shouldn't affect the regular login route.
    for _ in range(5):
        client.post(
            "/admin/auth/login",
            json={"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]},
        )
    resp = client.post("/auth/login", json={"email": "irrelevant@example.com", "password": "whatever"})
    assert resp.status_code == 401  # not 429 — a different route's limit
