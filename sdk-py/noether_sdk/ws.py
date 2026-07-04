"""WebSocket sub-client.

Mirrors the TypeScript SDK's WsClient: subscribe / unsubscribe / login /
ping with auto-reconnect (exponential backoff capped at 30 s) and full
re-subscription on reconnect.

``connect()`` resolves when any attempt receives the server hello and
raises on timeout (``connect_timeout``), on give-up (``auto_reconnect``
disabled) or on ``close()`` — it never hangs. Because the gateway may
process a subscribe before the login that preceded it, ``account.*``
subscriptions are re-sent after every successful login ack; ``rejected``
frames and failed logins surface through ``on_rejected`` / ``on_login``.
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
RejectedHandler = Callable[[list[str], str | None], None | Awaitable[None]]
LoginHandler = Callable[[bool, str | None], None | Awaitable[None]]

_PRIVATE_CHANNEL_PREFIX = "account."


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
        connect_timeout: float = 15.0,
        on_rejected: RejectedHandler | None = None,
        on_login: LoginHandler | None = None,
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
        self._connect_timeout = connect_timeout
        self._on_rejected = on_rejected
        self._on_login = on_login
        self._subs: dict[str, ChannelHandler] = {}
        self._socket: WebSocketClientProtocol | None = None
        self._closed = False
        self._connect_task: asyncio.Task[None] | None = None
        self._ready: asyncio.Future[None] | None = None

    async def connect(self) -> None:
        """Open the connection; returns once the server hello arrives.

        Raises ``TimeoutError`` after ``connect_timeout`` seconds, or
        ``ConnectionError`` if the client gives up (``auto_reconnect``
        disabled) or is closed before an attempt succeeds.
        """
        if self._connect_task is None or self._connect_task.done():
            self._closed = False
            self._ready = asyncio.get_running_loop().create_future()
            self._connect_task = asyncio.create_task(self._run())
        fut = self._ready
        assert fut is not None
        try:
            await asyncio.wait_for(asyncio.shield(fut), self._connect_timeout)
        except asyncio.TimeoutError:
            if not fut.done():
                fut.cancel()
            await self.close()
            raise TimeoutError(
                f"ws connect timed out after {self._connect_timeout}s"
            ) from None

    async def close(self) -> None:
        self._closed = True
        self._settle_ready(ConnectionError("ws closed by client"))
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

    async def _dispatch(self, handler: Callable[..., None | Awaitable[None]] | None, *args: Any) -> None:
        if handler is None:
            return
        result = handler(*args)
        if asyncio.iscoroutine(result):
            await result

    def _settle_ready(self, error: BaseException | None) -> None:
        fut = self._ready
        if fut is None or fut.done():
            return
        if error is not None:
            fut.set_exception(error)
            fut.exception()  # mark retrieved; awaiting connect() calls still raise
        else:
            fut.set_result(None)

    async def _run(self) -> None:
        attempt = 0
        try:
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
                            msg_type = msg.get("type")
                            if msg_type == "hello":
                                self._settle_ready(None)
                                continue
                            if msg_type == "login":
                                ok = msg.get("ok") is True
                                if ok:
                                    # The gateway may have evaluated our
                                    # subscribe before the login finished —
                                    # re-send private channels now that this
                                    # connection is authenticated.
                                    priv = [
                                        c
                                        for c in self._subs
                                        if c.startswith(_PRIVATE_CHANNEL_PREFIX)
                                    ]
                                    if priv:
                                        await sock.send(
                                            json.dumps(
                                                {"op": "subscribe", "channels": priv}
                                            )
                                        )
                                await self._dispatch(self._on_login, ok, msg.get("error"))
                                continue
                            if msg_type == "rejected":
                                await self._dispatch(
                                    self._on_rejected,
                                    list(msg.get("channels") or []),
                                    msg.get("reason"),
                                )
                                continue
                            channel = msg.get("channel")
                            if channel and channel in self._subs:
                                data = msg.get("data")
                                handler = self._subs[channel]
                                result = handler(data, channel)
                                if asyncio.iscoroutine(result):
                                    await result
                    self._socket = None
                except asyncio.CancelledError:
                    raise
                except Exception:
                    self._socket = None
                if self._closed or not self._auto_reconnect:
                    break
                backoff = min(self._max_backoff, self._min_backoff * (2 ** attempt))
                attempt += 1
                await asyncio.sleep(backoff)
        finally:
            self._socket = None
            # Give-up: fail a still-pending connect() instead of hanging it.
            self._settle_ready(ConnectionError("ws connection failed"))
