import datetime as dt

from app.plans import FREE_DAILY_LIMIT


def test_usage_me_starts_at_zero(client, auth_headers):
    resp = client.get("/usage/me", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 0
    assert body["limit"] == FREE_DAILY_LIMIT
    assert body["remaining"] == FREE_DAILY_LIMIT
    assert body["is_pro"] is False


def test_usage_increment_counts_up(client, auth_headers):
    resp = client.post("/usage/increment", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["count"] == 1

    resp = client.post("/usage/increment", headers=auth_headers)
    assert resp.json()["count"] == 2


def test_usage_blocks_at_daily_limit(client, auth_headers):
    for _ in range(FREE_DAILY_LIMIT):
        resp = client.post("/usage/increment", headers=auth_headers)
        assert resp.status_code == 200

    resp = client.post("/usage/increment", headers=auth_headers)
    assert resp.status_code == 402
    assert "limit reached" in resp.json()["detail"].lower()


def test_usage_resets_on_a_new_day(client, auth_headers, monkeypatch):
    for _ in range(FREE_DAILY_LIMIT):
        client.post("/usage/increment", headers=auth_headers)
    blocked = client.post("/usage/increment", headers=auth_headers)
    assert blocked.status_code == 402

    tomorrow = dt.datetime.now(dt.timezone.utc).date() + dt.timedelta(days=1)
    monkeypatch.setattr("app.routers.usage._today", lambda: tomorrow)

    resp = client.post("/usage/increment", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["count"] == 1
