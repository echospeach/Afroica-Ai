from app.plans import PRO_DAILY_SOFT_CAP


def _fake_stream(*args, **kwargs):
    yield "Hello"
    yield " world"


def test_chat_stream_requires_auth(client):
    resp = client.post("/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]})
    assert resp.status_code == 401


def test_chat_stream_rejects_free_user_and_never_calls_anthropic(client, auth_headers, monkeypatch):
    def _must_not_be_called(*args, **kwargs):
        raise AssertionError("Anthropic must never be reached for a non-Pro user")

    monkeypatch.setattr("app.routers.chat.stream_chat_completion", _must_not_be_called)

    resp = client.post(
        "/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]}, headers=auth_headers
    )
    assert resp.status_code == 402


def test_chat_stream_allows_pro_user(client, pro_auth_headers, monkeypatch):
    monkeypatch.setattr("app.routers.chat.stream_chat_completion", _fake_stream)

    resp = client.post(
        "/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]}, headers=pro_auth_headers
    )
    assert resp.status_code == 200
    assert resp.text == "Hello world"


def test_chat_stream_enforces_pro_daily_soft_cap(client, pro_auth_headers, monkeypatch):
    monkeypatch.setattr("app.routers.chat.stream_chat_completion", _fake_stream)

    for _ in range(PRO_DAILY_SOFT_CAP):
        resp = client.post(
            "/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]}, headers=pro_auth_headers
        )
        assert resp.status_code == 200

    blocked = client.post(
        "/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]}, headers=pro_auth_headers
    )
    assert blocked.status_code == 429
