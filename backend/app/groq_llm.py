"""Free tier's fast chat path — an open-weight model hosted on Groq's
free tier (see routers/chat.py POST /chat/free-stream). Deliberately
separate from llm.py's Anthropic client: this one is allowed to fail
(shared free quota exhausted, no key configured) and the caller falls
back to on-device WebLLM instead of surfacing an error.
"""

import json
import logging
from collections.abc import Iterator
from typing import Any

import httpx

from .config import settings
from .llm import build_system_prompt, load_persona
from .plans import GROQ_MODEL_ID, MAX_HISTORY_MESSAGES

logger = logging.getLogger("afroica.groq")

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"


class GroqUnavailableError(Exception):
    """Groq didn't accept the request — no API key configured, the shared
    free-tier quota is exhausted, or any other non-200 response. Callers
    should fall back to on-device inference, not surface this as an error."""


def _trim_history(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Same reasoning as llm.py's _trim_history — Groq's API is stateless
    # too, so an unbounded history makes every later message in a long
    # conversation slower and more likely to hit the per-minute token cap.
    return messages[-MAX_HISTORY_MESSAGES:]


def start_groq_stream(messages: list[dict[str, Any]]) -> tuple[httpx.Client, httpx.Response]:
    """Opens the Groq streaming connection and validates the response
    status *synchronously*, before any content streams — this has to
    happen outside a generator (see stream_groq_chunks) so a rejected
    request can be turned into a clean fallback signal by the route
    handler before it ever commits to a StreamingResponse.

    Raises GroqUnavailableError on anything but a 200. Caller owns the
    returned client/response and must ensure stream_groq_chunks (or an
    explicit close on both) eventually runs to release the connection."""
    if not settings.groq_api_key:
        raise GroqUnavailableError("GROQ_API_KEY not configured")

    system_prompt = build_system_prompt(load_persona())
    payload = {
        "model": GROQ_MODEL_ID,
        "messages": [
            {"role": "system", "content": system_prompt},
            *_trim_history(messages),
        ],
        "stream": True,
        "temperature": 0.7,
    }
    headers = {
        "Authorization": f"Bearer {settings.groq_api_key}",
        "Content-Type": "application/json",
    }

    client = httpx.Client(timeout=30)
    try:
        request = client.build_request("POST", GROQ_API_URL, headers=headers, json=payload)
        response = client.send(request, stream=True)
    except httpx.HTTPError as err:
        client.close()
        raise GroqUnavailableError(f"Could not reach Groq: {err}") from err

    if response.status_code != 200:
        body = response.read()
        response.close()
        client.close()
        logger.warning("Groq request rejected (status %s): %s", response.status_code, body[:300])
        raise GroqUnavailableError(f"Groq returned {response.status_code}")

    return client, response


def stream_groq_chunks(client: httpx.Client, response: httpx.Response) -> Iterator[str]:
    """Parses an already-validated open Groq stream (see start_groq_stream)
    into plain text chunks, in the OpenAI-compatible SSE format Groq uses.
    Always closes both the response and client when done, success or not."""
    try:
        for line in response.iter_lines():
            if not line or not line.startswith("data: "):
                continue
            data = line[len("data: "):]
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
            if delta:
                yield delta
    finally:
        response.close()
        client.close()
