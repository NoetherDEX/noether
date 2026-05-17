"""Typed error hierarchy mirroring the TypeScript SDK."""

from __future__ import annotations
from typing import Any


class NoetherError(Exception):
    """Base error class — all SDK failures inherit from this."""


class NetworkError(NoetherError):
    """Raised when the underlying HTTP request couldn't be made."""

    def __init__(self, message: str, cause: Any | None = None) -> None:
        super().__init__(message)
        self.cause = cause


class ApiError(NoetherError):
    """Raised on any non-2xx HTTP response."""

    def __init__(
        self,
        message: str,
        *,
        status: int,
        body: dict[str, Any] | None,
        url: str,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.body = body
        self.url = url


class AuthError(ApiError):
    """401 / 403 — invalid or missing credentials."""


class BadRequestError(ApiError):
    """400 — request body / params validation failed."""


class NotFoundError(ApiError):
    """404 — resource does not exist."""


class RateLimitError(ApiError):
    """429 — rate limit hit. `retry_after_sec` populated when present."""

    def __init__(
        self,
        message: str,
        *,
        status: int,
        body: dict[str, Any] | None,
        url: str,
        retry_after_sec: int | None,
    ) -> None:
        super().__init__(message, status=status, body=body, url=url)
        self.retry_after_sec = retry_after_sec


class ServerError(ApiError):
    """5xx — gateway or upstream failure."""


def classify_error(
    status: int,
    body: dict[str, Any] | None,
    url: str,
    retry_after_sec: int | None,
) -> ApiError:
    """Map a non-2xx response to its specialised ApiError subclass."""
    msg = str(body.get("error") or body.get("message") or f"HTTP {status}") if body else f"HTTP {status}"
    if status in (401, 403):
        return AuthError(msg, status=status, body=body, url=url)
    if status == 404:
        return NotFoundError(msg, status=status, body=body, url=url)
    if status == 429:
        return RateLimitError(
            msg, status=status, body=body, url=url, retry_after_sec=retry_after_sec
        )
    if status >= 500:
        return ServerError(msg, status=status, body=body, url=url)
    return BadRequestError(msg, status=status, body=body, url=url)
