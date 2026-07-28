from app.groq_llm import GroqUnavailableError
from app.plans import FREE_DAILY_LIMIT, PRO_DAILY_SOFT_CAP


def _fake_stream(*args, **kwargs):
    yield "Hello"
    yield " world"


def _fake_start_groq_stream(*args, **kwargs):
    # groq_llm.py's real return type is (httpx.Client, httpx.Response) —
    # these tests mock stream_groq_chunks too, so it never inspects these,
    # only that something truthy was returned to prove the "request was
    # accepted" path was taken.
    return ("fake-client", "fake-response")


def _fake_stream_groq_chunks(client, response):
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


def test_free_chat_stream_requires_auth(client):
    resp = client.post("/chat/free-stream", json={"messages": [{"role": "user", "content": "hi"}]})
    assert resp.status_code == 401


def test_free_chat_stream_success_counts_against_daily_usage(client, auth_headers, monkeypatch):
    monkeypatch.setattr("app.routers.chat.start_groq_stream", _fake_start_groq_stream)
    monkeypatch.setattr("app.routers.chat.stream_groq_chunks", _fake_stream_groq_chunks)

    resp = client.post(
        "/chat/free-stream", json={"messages": [{"role": "user", "content": "hi"}]}, headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.text == "Hello world"

    usage = client.get("/usage/me", headers=auth_headers).json()
    assert usage["count"] == 1


def test_free_chat_stream_signals_fallback_without_spending_usage(client, auth_headers, monkeypatch):
    def _raise(*args, **kwargs):
        raise GroqUnavailableError("shared free quota exhausted")

    monkeypatch.setattr("app.routers.chat.start_groq_stream", _raise)

    resp = client.post(
        "/chat/free-stream", json={"messages": [{"role": "user", "content": "hi"}]}, headers=auth_headers
    )
    assert resp.status_code == 503

    # A rejected Groq attempt shouldn't cost the user a message — they're
    # about to retry through the (also free) on-device fallback instead.
    usage = client.get("/usage/me", headers=auth_headers).json()
    assert usage["count"] == 0


def test_free_chat_stream_enforces_daily_limit_without_calling_groq(client, auth_headers, monkeypatch):
    monkeypatch.setattr("app.routers.chat.start_groq_stream", _fake_start_groq_stream)
    monkeypatch.setattr("app.routers.chat.stream_groq_chunks", _fake_stream_groq_chunks)

    for _ in range(FREE_DAILY_LIMIT):
        resp = client.post(
            "/chat/free-stream", json={"messages": [{"role": "user", "content": "hi"}]}, headers=auth_headers
        )
        assert resp.status_code == 200

    def _must_not_be_called(*args, **kwargs):
        raise AssertionError("Groq must not be reached once the daily free limit is already used up")

    monkeypatch.setattr("app.routers.chat.start_groq_stream", _must_not_be_called)

    blocked = client.post(
        "/chat/free-stream", json={"messages": [{"role": "user", "content": "hi"}]}, headers=auth_headers
    )
    assert blocked.status_code == 429
