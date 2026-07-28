"""Wraps the Anthropic client for the Pro (server-side) chat path.

Mirrors js/persona.js: both read persona.json and build an equivalent
system prompt from the same fields, so behavior stays consistent whether a
message is answered by the free on-device model or by this backend.
"""

import datetime as dt
import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import anthropic

from .config import settings
from .plans import CHAT_MODEL_ID, MAX_HISTORY_MESSAGES, MAX_WEB_SEARCHES_PER_REQUEST

# Anthropic's web search tool, versioned per their API — see
# https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/web-search-tool
WEB_SEARCH_TOOL_TYPE = "web_search_20250305"

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


def build_system_prompt(
    persona: dict, image_capable: bool = False, web_search_capable: bool = False
) -> str:
    parts = [f"You are {persona['ai_name']}, a helpful assistant."]
    # The model's training data has its own cutoff and knows nothing about
    # that on its own — without this, it confidently states stale facts
    # (an old president, an old software version) as if current. This
    # doesn't give it real-time knowledge, just tells it to be honest
    # about the gap instead of asserting outdated info as fact.
    today = dt.datetime.now(dt.timezone.utc).strftime("%B %d, %Y")
    parts.append(
        f"Today's date is {today}. Your training data has a knowledge cutoff and may not "
        "include recent events, current officeholders, prices, or other time-sensitive "
        "facts — if asked about something that could plausibly have changed since your "
        "training, say so honestly and note your answer might be outdated, rather than "
        "confidently stating old information as current fact."
    )
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
    # Only true for the Pro path — free tier has no search tool at all, so
    # telling it to "verify with a search" would be an instruction it has
    # no way to follow.
    if web_search_capable:
        parts.append(
            "You have a real web search tool — use it whenever a question depends on "
            "current, specific, or verifiable facts (recent events, prices, statistics, "
            "current officeholders, specific people/organizations/products) rather than "
            "answering from memory and risking a wrong guess. Don't guess or fabricate "
            "names, numbers, dates, or other specifics you're not confident of — search "
            "for them or say plainly that you don't know, never present a guess as a fact."
        )
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


def stream_chat_completion(
    messages: list[dict[str, Any]],
    *,
    web_search_enabled: bool = False,
    on_search_usage: Callable[[int], None] | None = None,
) -> Iterator[str]:
    """Yields text chunks for the Pro chat path. `messages` are already in
    Anthropic Messages API shape (the frontend builds them that way for
    this endpoint specifically — see js/billing.js / js/main.js).

    `web_search_enabled` turns on Claude's native web search tool (real
    per-search cost — see plans.PRO_DAILY_SEARCH_CAP) — Claude decides on
    its own whether a given question actually needs a search. Once
    streaming completes, `on_search_usage(count)` is called with however
    many searches were actually performed (0 if none), so the caller
    (routers/chat.py) can update the daily search-usage counter — kept as
    a callback rather than a DB write here so this module stays
    DB-agnostic, matching its existing separation of concerns."""
    system_prompt = build_system_prompt(
        load_persona(), image_capable=True, web_search_capable=web_search_enabled
    )
    client = get_client()

    kwargs: dict[str, Any] = {}
    if web_search_enabled:
        kwargs["tools"] = [
            {
                "type": WEB_SEARCH_TOOL_TYPE,
                "name": "web_search",
                "max_uses": MAX_WEB_SEARCHES_PER_REQUEST,
            }
        ]

    with client.messages.stream(
        model=CHAT_MODEL_ID,
        max_tokens=2048,
        system=system_prompt,
        messages=_trim_history(messages),
        **kwargs,
    ) as stream:
        yield from stream.text_stream
        final_message = stream.get_final_message()

    if on_search_usage is not None:
        searches_used = 0
        server_tool_use = getattr(final_message.usage, "server_tool_use", None)
        if server_tool_use is not None:
            searches_used = getattr(server_tool_use, "web_search_requests", 0) or 0
        on_search_usage(searches_used)
