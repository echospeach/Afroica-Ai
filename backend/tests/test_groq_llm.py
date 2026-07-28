import pytest

from app.config import settings as app_settings
from app.groq_llm import GroqUnavailableError, start_groq_stream


def test_start_groq_stream_fails_fast_without_api_key(monkeypatch):
    # The default, unconfigured state (no GROQ_API_KEY in .env) — must
    # fail immediately without attempting any network call, since that's
    # what lets the whole feature no-op safely for anyone who hasn't set
    # up Groq yet, falling straight back to on-device inference.
    monkeypatch.setattr(app_settings, "groq_api_key", "")
    with pytest.raises(GroqUnavailableError):
        start_groq_stream([{"role": "user", "content": "hi"}])
