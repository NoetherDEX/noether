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

    @property
    def code(self) -> str | None:
        """Machine readable error code from the response body, e.g.
        not_in_beta or key_limit_reached. None when the body has none."""
        if isinstance(self.body, dict):
            value = self.body.get("error")
            if isinstance(value, str):
                return value
        return None


class AuthError(ApiError):
    """401 responses: missing, malformed, stale or invalid credentials."""


class ForbiddenError(AuthError):
    """403 responses. Extends AuthError so existing handlers keep working,
    while callers can now tell a closed beta rejection (code not_in_beta)
    apart from a bad credential 401."""


class BadRequestError(ApiError):
    """400 — request body / params validation failed."""


class NotFoundError(ApiError):
    """404 — resource does not exist."""


class ConflictError(ApiError):
    """409 responses, e.g. code key_limit_reached when a wallet already
    holds the maximum number of active API keys."""


class RegionRestrictedError(ApiError):
    """451 responses: trading endpoints refused from a restricted
    jurisdiction (code region_restricted)."""


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


class ServiceUnavailableError(ServerError):
    """503 responses. Extends ServerError so existing handlers keep working.
    When the gateway asks the client to resubmit shortly (code
    try_again_later from tx submit), `retry_after_sec` carries the retry
    hint in seconds read from the response headers."""

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


def classify_error(
    status: int,
    body: dict[str, Any] | None,
    url: str,
    retry_after_sec: int | None,
) -> ApiError:
    """Map a non-2xx response to its specialised ApiError subclass."""
    msg = str(body.get("error") or body.get("message") or f"HTTP {status}") if body else f"HTTP {status}"
    if status == 401:
        return AuthError(msg, status=status, body=body, url=url)
    if status == 403:
        return ForbiddenError(msg, status=status, body=body, url=url)
    if status == 404:
        return NotFoundError(msg, status=status, body=body, url=url)
    if status == 409:
        return ConflictError(msg, status=status, body=body, url=url)
    if status == 429:
        return RateLimitError(
            msg, status=status, body=body, url=url, retry_after_sec=retry_after_sec
        )
    if status == 451:
        return RegionRestrictedError(msg, status=status, body=body, url=url)
    if status == 503:
        return ServiceUnavailableError(
            msg, status=status, body=body, url=url, retry_after_sec=retry_after_sec
        )
    if status >= 500:
        return ServerError(msg, status=status, body=body, url=url)
    return BadRequestError(msg, status=status, body=body, url=url)
