"""WebSocket sub-client.

Mirrors @noether/sdk's WsClient: subscribe / unsubscribe / login / ping
with auto-reconnect (exponential backoff capped at 30 s) and full
re-subscription on reconnect.
"""

from __future__ import annotations
import asyncio
import json
from typing import Any, Awaitable, Callable

try:
    import websockets
    from websockets.client import WebSocketClientProtocol
except ImportError:  # pragma: no cover - tested via the dev extra
    websockets = None  # type: ignore[assignment]
    WebSocketClientProtocol = Any  # type: ignore[assignment]

from .transport import Credentials


ChannelHandler = Callable[[Any, str], None | Awaitable[None]]


class WsClient:
    """Auto-reconnecting WebSocket client for /v1/ws."""

    def __init__(
        self,
        url: str,
        *,
        credentials: Credentials | None = None,
        min_backoff: float = 0.25,
        max_backoff: float = 30.0,
        auto_reconnect: bool = True,
    ) -> None:
        if websockets is None:  # pragma: no cover
            raise RuntimeError(
                "noether_sdk.ws requires the `websockets` package — install via "
                "`pip install noether-sdk` (it is a default dep)."
            )
        self.url = url
        self._credentials = credentials
        self._min_backoff = min_backoff
        self._max_backoff = max_backoff
        self._auto_reconnect = auto_reconnect
        self._subs: dict[str, ChannelHandler] = {}
        self._socket: WebSocketClientProtocol | None = None
        self._closed = False
        self._connect_task: asyncio.Task[None] | None = None
        self._ready: asyncio.Event = asyncio.Event()

    async def connect(self) -> None:
        if self._connect_task is not None and not self._connect_task.done():
            await self._ready.wait()
            return
        self._closed = False
        self._connect_task = asyncio.create_task(self._run())
        await self._ready.wait()

    async def close(self) -> None:
        self._closed = True
        if self._socket is not None:
            await self._socket.close()
        if self._connect_task is not None:
            self._connect_task.cancel()

    async def subscribe(self, channel: str, handler: ChannelHandler) -> None:
        self._subs[channel] = handler
        await self._send({"op": "subscribe", "channels": [channel]})

    async def unsubscribe(self, channel: str) -> None:
        self._subs.pop(channel, None)
        await self._send({"op": "unsubscribe", "channels": [channel]})

    async def ping(self) -> None:
        await self._send({"op": "ping"})

    def set_credentials(self, credentials: Credentials | None) -> None:
        self._credentials = credentials

    @property
    def is_open(self) -> bool:
        return self._socket is not None and not self._socket.closed

    # ───── internals ───────────────────────────────────────────────────────

    async def _send(self, payload: dict[str, Any]) -> None:
        if self._socket is None:
            return
        await self._socket.send(json.dumps(payload))

    async def _run(self) -> None:
        attempt = 0
        while not self._closed:
            try:
                async with websockets.connect(self.url) as sock:
                    self._socket = sock
                    attempt = 0
                    if self._credentials is not None:
                        await sock.send(
                            json.dumps(
                                {
                                    "op": "login",
                                    "keyId": self._credentials.key_id,
                                    "secret": self._credentials.secret,
                                }
                            )
                        )
                    if self._subs:
                        await sock.send(
                            json.dumps(
                                {
                                    "op": "subscribe",
                                    "channels": list(self._subs.keys()),
                                }
                            )
                        )

                    async for raw in sock:
                        try:
                            msg = json.loads(raw)
                        except (TypeError, ValueError):
                            continue
                        if msg.get("type") == "hello":
                            self._ready.set()
                            continue
                        channel = msg.get("channel")
                        if channel and channel in self._subs:
                            data = msg.get("data")
                            handler = self._subs[channel]
                            result = handler(data, channel)
                            if asyncio.iscoroutine(result):
                                await result
                self._socket = None
            except Exception:
                self._socket = None
            if self._closed or not self._auto_reconnect:
                return
            backoff = min(self._max_backoff, self._min_backoff * (2 ** attempt))
            attempt += 1
            await asyncio.sleep(backoff)
