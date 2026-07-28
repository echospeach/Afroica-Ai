import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..groq_llm import GroqUnavailableError, start_groq_stream, stream_groq_chunks
from ..llm import stream_chat_completion
from ..models import User
from ..plans import PRO_DAILY_SEARCH_CAP, daily_limit_for, is_pro
from ..schemas import ChatRequest
from .usage import _get_or_create_search_usage, _get_or_create_usage, _today

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger("afroica.chat")


@router.post("/stream")
def chat_stream(
    body: ChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not is_pro(user.subscription):
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "This is a Pro feature — subscribe for fast server-side responses.",
        )

    row = _get_or_create_usage(db, user.id, _today())
    limit = daily_limit_for(user.subscription)
    if row.count >= limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Daily fair-use limit reached — please try again tomorrow.",
        )

    row.count += 1
    db.commit()

    search_row = _get_or_create_search_usage(db, user.id, _today())
    web_search_enabled = search_row.count < PRO_DAILY_SEARCH_CAP

    def _track_search_usage(searches_used: int) -> None:
        # Called once streaming completes (see llm.stream_chat_completion)
        # with however many searches Claude actually performed. Re-fetches
        # rather than closing over search_row so this is correct even if
        # the request happens to straddle a UTC day rollover mid-stream.
        if searches_used <= 0:
            return
        row2 = _get_or_create_search_usage(db, user.id, _today())
        row2.count += searches_used
        db.commit()

    anthropic_messages = [{"role": m.role, "content": m.content} for m in body.messages]
    return StreamingResponse(
        stream_chat_completion(
            anthropic_messages,
            web_search_enabled=web_search_enabled,
            on_search_usage=_track_search_usage,
        ),
        media_type="text/plain",
    )


@router.post("/free-stream")
def free_chat_stream(
    body: ChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Free tier's fast path — an open-weight model on Groq's free,
    no-card-required tier, shared org-wide across every free user. Returns
    503 if Groq won't accept the request (no key configured, shared quota
    exhausted, etc.) so the frontend can fall back to on-device WebLLM —
    that's an expected, routine outcome under load, not a real error."""
    row = _get_or_create_usage(db, user.id, _today())
    limit = daily_limit_for(user.subscription)
    if row.count >= limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Daily fair-use limit reached — please try again tomorrow.",
        )

    groq_messages = [{"role": m.role, "content": m.content} for m in body.messages]
    try:
        client, groq_response = start_groq_stream(groq_messages)
    except GroqUnavailableError as err:
        logger.info("Groq unavailable, signaling frontend to fall back: %s", err)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Fast mode is temporarily at capacity — falling back to on-device mode.",
        )

    # Only counts against the daily cap once Groq has actually accepted
    # the request — a rejected attempt shouldn't cost the user a message.
    row.count += 1
    db.commit()

    return StreamingResponse(
        stream_groq_chunks(client, groq_response), media_type="text/plain"
    )
