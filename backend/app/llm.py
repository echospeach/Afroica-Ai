"""Wraps the Anthropic client for the Pro (server-side) chat path.

Mirrors js/persona.js: both read persona.json and build an equivalent
system prompt from the same fields, so behavior stays consistent whether a
message is answered by the free on-device model or by this backend.
"""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import anthropic

from .config import settings
from .plans import CHAT_MODEL_ID, MAX_HISTORY_MESSAGES

PERSONA_PATH = Path(__file__).resolve().parent.parent.parent / "persona.json"

DEFAULT_PERSONA = {
    "ai_name": "Afroica AI",
    "user_name": "",
    "tone": "warm, clear, and concise",
    "expertise": [
        "African languages",
        "African cultures and history",
        "everyday practical topics",
    ],
    "instructions": "",
}


def load_persona() -> dict:
    try:
        data = json.loads(PERSONA_PATH.read_text(encoding="utf-8"))
        return {**DEFAULT_PERSONA, **data}
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_PERSONA)


def build_system_prompt(persona: dict, image_capable: bool = False) -> str:
    parts = [f"You are {persona['ai_name']}, a helpful assistant."]
    if persona.get("expertise"):
        parts.append(f"You have strong knowledge of: {', '.join(persona['expertise'])}.")
    if persona.get("user_name"):
        parts.append(
            f"You're talking with {persona['user_name']} — address them by name when it feels natural."
        )
    if persona.get("tone"):
        parts.append(f"Tone: {persona['tone']}.")
    # Only true for the Pro path (Claude) — the free tier's Groq model and
    # the on-device WebLLM fallback are both text-only. Claiming image
    # understanding to a model that doesn't have it risks confusing,
    # hedging responses about images that were never actually sent.
    if image_capable:
        parts.append("You can also see and discuss images the user attaches.")
    parts.append(
        "Answer the user's actual question directly and specifically first — "
        "don't open with generic background, disclaimers, or unrelated context "
        "unless it's needed to answer. Stay on the topic they actually asked about."
    )
    if persona.get("instructions"):
        parts.append(persona["instructions"])
    return " ".join(parts)


_client: anthropic.Anthropic | None = None


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return _client


def _trim_history(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keeps only the most recent MAX_HISTORY_MESSAGES entries so a long
    conversation doesn't get more expensive with every turn (the API is
    stateless — the full history is resent on every request). Anthropic
    requires the first message to have role "user", so if trimming lands
    on an "assistant" message, drop it too rather than send an invalid
    request."""
    trimmed = messages[-MAX_HISTORY_MESSAGES:]
    while trimmed and trimmed[0]["role"] != "user":
        trimmed = trimmed[1:]
    return trimmed


def stream_chat_completion(messages: list[dict[str, Any]]) -> Iterator[str]:
    """Yields text chunks for the Pro chat path. `messages` are already in
    Anthropic Messages API shape (the frontend builds them that way for
    this endpoint specifically — see js/billing.js / js/main.js)."""
    system_prompt = build_system_prompt(load_persona(), image_capable=True)
    client = get_client()
    with client.messages.stream(
        model=CHAT_MODEL_ID,
        max_tokens=2048,
        system=system_prompt,
        messages=_trim_history(messages),
    ) as stream:
        yield from stream.text_stream
