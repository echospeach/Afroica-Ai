from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..llm import stream_chat_completion
from ..models import User
from ..plans import daily_limit_for, is_pro
from ..schemas import ChatRequest
from .usage import _get_or_create_usage, _today

router = APIRouter(prefix="/chat", tags=["chat"])


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

    anthropic_messages = [{"role": m.role, "content": m.content} for m in body.messages]
    return StreamingResponse(
        stream_chat_completion(anthropic_messages), media_type="text/plain"
    )
