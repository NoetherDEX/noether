"""Shared HTTP transport for every sub-client."""

from __future__ import annotations
import time
from dataclasses import dataclass
from typing import Any

import httpx

from .errors import NetworkError, classify_error


@dataclass
class Credentials:
    key_id: str
    secret: str


class Transport:
    """Async HTTP client that handles Bearer auth + error classification."""

    def __init__(
        self,
        base_url: str,
        *,
        client: httpx.AsyncClient | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=timeout)

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any | None = None,
        credentials: Credentials | None = None,
        with_timestamp: bool = True,
    ) -> Any:
        url = f"{self.base_url}{path}" if path.startswith("/") else f"{self.base_url}/{path}"
        headers: dict[str, str] = {"accept": "application/json"}
        if json is not None:
            headers["content-type"] = "application/json"
        if credentials is not None:
            headers["authorization"] = f"Bearer {credentials.key_id}:{credentials.secret}"
            if with_timestamp:
                headers["x-timestamp"] = str(int(time.time()))

        clean_params = (
            {k: v for k, v in params.items() if v is not None} if params else None
        )

        try:
            response = await self._client.request(
                method,
                url,
                params=clean_params,
                json=json,
                headers=headers,
            )
        except httpx.RequestError as exc:
            raise NetworkError(f"{method} {url} failed: {exc}", cause=exc) from exc

        body: dict[str, Any] | None = None
        try:
            body = response.json() if response.text else None
        except ValueError:
            body = None

        if not response.is_success:
            retry_after_raw = response.headers.get("retry-after")
            retry_after = int(retry_after_raw) if retry_after_raw and retry_after_raw.isdigit() else None
            raise classify_error(response.status_code, body, url, retry_after)
        return body
