"""Sends transactional email (currently just password resets) via Resend
if RESEND_API_KEY is configured; otherwise logs the message to the server
console instead. The console fallback is fully functional for local dev
and testing — no email account needed, zero cost, and the reset link
still works (just copy it from the terminal instead of an inbox).

Resend has a genuinely free tier (100 emails/day, 3,000/month) if you want
real delivery in production — see the README for setup. Nothing here
costs money until you set a real RESEND_API_KEY.
"""

import logging

import httpx

from .config import settings

logger = logging.getLogger("afroica.email")


def send_email(to: str, subject: str, body: str) -> None:
    if not settings.resend_api_key:
        logger.info("EMAIL (no provider configured) to=%s subject=%s\n%s", to, subject, body)
        return

    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.email_from, "to": [to], "subject": subject, "text": body},
            timeout=10,
        )
        response.raise_for_status()
    except httpx.HTTPError as err:
        # A failed send shouldn't break the request that triggered it (the
        # caller already told the user "check your email" and shouldn't
        # un-say that) — log it so the operator notices instead.
        logger.warning("Failed to send email to %s via Resend: %s", to, err)
