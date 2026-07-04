"""WsClient behavior against a fake socket (no network)."""

from __future__ import annotations
import asyncio
import json
from typing import Any

import pytest

import noether_sdk.ws as ws_module
from noether_sdk.ws import WsClient


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()
        self.closed = False

    async def send(self, data: str) -> None:
        self.sent.append(json.loads(data))

    async def close(self) -> None:
        self.closed = True
        self._queue.put_nowait(None)

    def feed(self, payload: dict[str, Any]) -> None:
        self._queue.put_nowait(json.dumps(payload))

    def end(self) -> None:
        self._queue.put_nowait(None)

    def __aiter__(self) -> "FakeSocket":
        return self

    async def __anext__(self) -> str:
        item = await self._queue.get()
        if item is None:
            raise StopAsyncIteration
        return item


class _FakeConnectCtx:
    def __init__(self, sock: FakeSocket | Exception) -> None:
        self._sock = sock

    async def __aenter__(self) -> FakeSocket:
        if isinstance(self._sock, Exception):
            raise self._sock
        return self._sock

    async def __aexit__(self, *_exc: object) -> bool:
        return False


class FakeWebsockets:
    """Stub for the `websockets` module: scripted sockets, FIFO per attempt."""

    def __init__(self, *sockets: FakeSocket | Exception) -> None:
        self.sockets = list(sockets)
        self.attempts = 0

    def connect(self, _url: str) -> _FakeConnectCtx:
        self.attempts += 1
        if not self.sockets:
            return _FakeConnectCtx(ConnectionRefusedError("no more scripted sockets"))
        return _FakeConnectCtx(self.sockets.pop(0))


@pytest.fixture
def patch_ws(monkeypatch: pytest.MonkeyPatch):
    def _patch(*sockets: FakeSocket | Exception) -> FakeWebsockets:
        fake = FakeWebsockets(*sockets)
        monkeypatch.setattr(ws_module, "websockets", fake)
        return fake

    return _patch


async def _drain(loops: int = 10) -> None:
    for _ in range(loops):
        await asyncio.sleep(0)


async def test_connect_resolves_on_hello(patch_ws) -> None:
    sock = FakeSocket()
    sock.feed({"type": "hello", "ts": 1})
    patch_ws(sock)

    client = WsClient("ws://test/v1/ws", connect_timeout=1.0)
    await client.connect()
    assert client.is_open
    await client.close()


async def test_connect_raises_on_give_up_without_reconnect(patch_ws) -> None:
    patch_ws(ConnectionRefusedError("boom"))

    client = WsClient("ws://test/v1/ws", auto_reconnect=False, connect_timeout=1.0)
    with pytest.raises(ConnectionError):
        await client.connect()


async def test_connect_times_out_instead_of_hanging(patch_ws) -> None:
    sock = FakeSocket()  # never sends hello
    patch_ws(sock)

    client = WsClient("ws://test/v1/ws", connect_timeout=0.05)
    with pytest.raises(TimeoutError):
        await client.connect()


async def test_connect_resolves_via_second_attempt(patch_ws) -> None:
    sock2 = FakeSocket()
    sock2.feed({"type": "hello", "ts": 2})
    patch_ws(ConnectionRefusedError("first attempt dies"), sock2)

    client = WsClient("ws://test/v1/ws", min_backoff=0.001, connect_timeout=1.0)
    await client.connect()
    assert client.is_open
    await client.close()


async def test_rejected_and_failed_login_surface(patch_ws) -> None:
    sock = FakeSocket()
    sock.feed({"type": "hello", "ts": 1})
    sock.feed({"type": "login", "ok": False, "error": "invalid_credentials"})
    sock.feed({"type": "rejected", "channels": ["account.events.GABC"]})
    patch_ws(sock)

    rejected: list[tuple[list[str], str | None]] = []
    logins: list[tuple[bool, str | None]] = []
    client = WsClient(
        "ws://test/v1/ws",
        connect_timeout=1.0,
        on_rejected=lambda channels, reason: rejected.append((channels, reason)),
        on_login=lambda ok, error: logins.append((ok, error)),
    )
    await client.connect()
    await _drain()
    assert logins == [(False, "invalid_credentials")]
    assert rejected == [(["account.events.GABC"], None)]
    await client.close()


async def test_resends_account_subs_after_login_ack(patch_ws) -> None:
    sock = FakeSocket()
    sock.feed({"type": "hello", "ts": 1})
    patch_ws(sock)

    client = WsClient("ws://test/v1/ws", connect_timeout=1.0)
    await client.connect()
    await client.subscribe("account.events.GABC", lambda data, ch: None)
    await client.subscribe("ticker.BTC", lambda data, ch: None)

    # Gateway acks the (raced) login after the subscribes.
    sock.feed({"type": "login", "ok": True, "owner": "GABC", "tier": "standard"})
    await _drain()

    sub_frames = [m for m in sock.sent if m.get("op") == "subscribe"]
    assert sub_frames[-1]["channels"] == ["account.events.GABC"]
    await client.close()
