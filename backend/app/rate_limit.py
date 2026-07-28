"""A small in-memory rate limiter for auth endpoints (signup/login are the
classic brute-force and spam-signup targets).

In-memory is fine here because the app runs as a single process (Render's
free tier is one instance) — no shared state needed across workers. If you
ever scale to multiple backend instances, swap this for a Redis-backed
limiter instead; call sites don't need to change.
"""

import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

_attempts: dict[str, list[float]] = defaultdict(list)


def _client_ip(request: Request) -> str:
    # Render (and most PaaS reverse proxies) put the real client IP in
    # X-Forwarded-For; request.client.host would otherwise be the proxy's.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(max_attempts: int, window_seconds: int):
    """FastAPI dependency factory — `Depends(rate_limit(5, 900))` allows at
    most 5 calls per client IP, per route, per 900-second window."""

    def dependency(request: Request) -> None:
        key = f"{request.url.path}:{_client_ip(request)}"
        now = time.time()
        window_start = now - window_seconds

        attempts = _attempts[key]
        attempts[:] = [t for t in attempts if t > window_start]

        if len(attempts) >= max_attempts:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many attempts — please wait a bit before trying again.",
            )

        attempts.append(now)

    return dependency
