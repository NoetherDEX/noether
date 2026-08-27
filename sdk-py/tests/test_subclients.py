"""Sub client wiring against a scripted httpx.MockTransport (no network).

Covers the gateway parity additions (markets stats, candles, oracle
health, trades, adl queue, account volume and shortfall), the
account.positions fix that returns the full { positions, events } route
shape, the before_ts cursors, and the transport level 503 retry hint.
"""

from __future__ import annotations
from typing import Any

import httpx
import pytest

from noether_sdk import NoetherClient
from noether_sdk.errors import ServiceUnavailableError
from noether_sdk.transport import Credentials


class Recorder:
    """Scripted responses, FIFO; records every request for assertions."""

    def __init__(self, *responses: tuple[int, Any] | tuple[int, Any, dict[str, str]]) -> None:
        self.requests: list[httpx.Request] = []
        self._responses = list(responses)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert self._responses, f"no scripted response left for {request.url}"
        script = self._responses.pop(0)
        status, payload = script[0], script[1]
        headers = script[2] if len(script) > 2 else {}
        return httpx.Response(status, json=payload, headers=headers)


def make_client(recorder: Recorder, credentials: Credentials | None = None) -> NoetherClient:
    http = httpx.AsyncClient(transport=httpx.MockTransport(recorder))
    return NoetherClient("http://api.test", credentials=credentials, client=http)


CREDS = Credentials(key_id="nk_x", secret="shh")

EVENT = {
    "eventId": "ev1",
    "contractId": "C123",
    "topic": "position_opened",
    "ledger": 100,
    "ledgerCloseTs": 1_784_000_000,
    "txHash": "cafe",
    "payload": {"positionId": 12},
    "insertedAt": 1_784_000_001,
}

POSITION = {
    "positionId": 12,
    "trader": "GABC",
    "asset": "BTC",
    "direction": 0,
    "size": "1000000000",
    "entryPrice": "600000000000",
    "openedAt": 100,
    "openedTxHash": "cafe",
}


async def test_markets_stats() -> None:
    rec = Recorder(
        (
            200,
            {
                "stats": [
                    {
                        "asset": "BTC",
                        "openInterestLong": "1000000000",
                        "openInterestShort": "400000000",
                        "openInterestNet": "600000000",
                        "openPositions": 3,
                        "volume24h": "5000000000",
                    }
                ],
                "solvency": {
                    "cumulativeBadDebtCovered": "120",
                    "cumulativeBadDebtLpAbsorbed": "0",
                    "badDebtEvents": 1,
                },
            },
        )
    )
    async with make_client(rec) as client:
        res = await client.markets.stats()
    assert rec.requests[0].url.path == "/v1/markets/stats"
    assert res.stats[0].open_interest_net == "600000000"
    assert res.stats[0].volume_24h == "5000000000"
    assert res.solvency.cumulative_bad_debt_covered == "120"
    assert res.solvency.bad_debt_events == 1


async def test_markets_stats_capacity_blocks_are_optional() -> None:
    row = {
        "asset": "XLM",
        "openInterestLong": "252541116930",
        "openInterestShort": "1614090000000",
        "openInterestNet": "-1361548883070",
        "openPositions": 8,
        "volume24h": "1486090000000",
    }
    capacity = {
        "headroomLong": "1000000000000",
        "headroomShort": "803851335007",
        "bindingLong": "maxPosition",
        "bindingShort": "skew",
        "oiLong": "252541116930",
        "oiShort": "1614090000000",
        "netSkew": "-1361548883070",
        "sideCap": "3609000363462",
        "skewCap": "2165400218077",
        "assetCapBps": 2500,
        "capAbs": "0",
        "skewCapBps": 1500,
        "maxPositionSize": "1000000000000",
    }
    pool = {
        "aum": "14436001453851",
        "reservedPayout": "8961594157885",
        "usdcBalance": "14747198788346",
        "shortfallReserve": "0",
        "reserveCapBps": 7000,
        "reserveCap": "10105201017695",
        "aggregateHeadroom": "1143606859810",
        "aggregateBinding": "aggregate",
        "asOfLedger": 4314754,
        "ts": 1787596843664,
        "stale": False,
    }
    solvency = {"cumulativeBadDebtCovered": "0", "cumulativeBadDebtLpAbsorbed": "0", "badDebtEvents": 0}
    rec = Recorder(
        (200, {"stats": [{**row, "capacity": capacity}], "pool": pool, "solvency": solvency}),
        (200, {"stats": [row], "solvency": solvency}),
    )
    async with make_client(rec) as client:
        with_capacity = await client.markets.stats()
        without = await client.markets.stats()
    assert with_capacity.stats[0].capacity is not None
    assert with_capacity.stats[0].capacity.headroom_short == "803851335007"
    assert with_capacity.stats[0].capacity.binding_short == "skew"
    assert with_capacity.pool is not None
    assert with_capacity.pool.aggregate_headroom == "1143606859810"
    assert with_capacity.pool.stale is False
    assert without.stats[0].capacity is None
    assert without.pool is None


async def test_markets_candles_forwards_params_and_uppercases() -> None:
    rec = Recorder(
        (
            200,
            {
                "candles": [{"time": 1000, "open": 1.1, "high": 1.2, "low": 1.0, "close": 1.15}],
                "source": "noeracle",
            },
        )
    )
    async with make_client(rec) as client:
        res = await client.markets.candles("btc", interval="5m", limit=10)
    url = rec.requests[0].url
    assert url.path == "/v1/candles"
    assert url.params["asset"] == "BTC"
    assert url.params["interval"] == "5m"
    assert url.params["limit"] == "10"
    assert res.source == "noeracle"
    assert res.candles[0].close == 1.15


async def test_oracle_health() -> None:
    rec = Recorder(
        (
            200,
            {
                "status": "degraded",
                "onchain": {
                    "staleAfterSec": 60,
                    "staleCount": 1,
                    "assets": [
                        {"asset": "BTC", "priceFloat": 60000.0, "ageSec": 5, "stale": False, "error": None},
                        {"asset": "ETH", "priceFloat": None, "ageSec": None, "stale": True, "error": "read failed"},
                    ],
                },
                "keeper": {"configured": True, "ageMs": 12000, "stale": False, "lastReport": {"cycle": 42}},
            },
        )
    )
    async with make_client(rec) as client:
        health = await client.oracle.health()
    assert rec.requests[0].url.path == "/v1/oracle/health"
    assert health.status == "degraded"
    assert health.onchain.stale_after_sec == 60
    assert health.onchain.assets[1].stale is True
    assert health.keeper.configured is True
    assert health.keeper.last_report == {"cycle": 42}


async def test_trades_list_forwards_every_filter() -> None:
    rec = Recorder(
        (
            200,
            {
                "trades": [
                    {
                        "positionId": 7,
                        "trader": "GABC",
                        "kind": "close",
                        "asset": "BTC",
                        "direction": 0,
                        "size": "1000000000",
                        "entryPrice": "600000000000",
                        "closePrice": "610000000000",
                        "pnl": "16666666",
                        "ledger": 100,
                        "ts": 1_784_000_000,
                        "txHash": "cafe",
                    }
                ]
            },
        )
    )
    async with make_client(rec) as client:
        rows = await client.trades.list(
            trader="GABC", asset="btc", before_ts=1_785_000_000, limit=25, include_opens=True
        )
    url = rec.requests[0].url
    assert url.path == "/v1/trades"
    assert url.params["trader"] == "GABC"
    assert url.params["asset"] == "BTC"
    assert url.params["before_ts"] == "1785000000"
    assert url.params["limit"] == "25"
    assert url.params["include_opens"] == "true"
    assert rows[0].kind == "close"
    assert rows[0].pnl == "16666666"


async def test_trades_list_cross_liquidation_null_fields() -> None:
    rec = Recorder(
        (
            200,
            {
                "trades": [
                    {
                        "positionId": None,
                        "trader": "GDEF",
                        "kind": "cross_liquidation",
                        "asset": None,
                        "direction": None,
                        "size": None,
                        "entryPrice": None,
                        "closePrice": None,
                        "pnl": "-5000000",
                        "ledger": 101,
                        "ts": 1_784_000_100,
                        "txHash": "beef",
                    }
                ]
            },
        )
    )
    async with make_client(rec) as client:
        rows = await client.trades.list()
    assert rec.requests[0].url.query == b""
    assert rows[0].position_id is None
    assert rows[0].kind == "cross_liquidation"


async def test_adl_queue() -> None:
    rec = Recorder(
        (
            200,
            {
                "asset": "BTC",
                "updatedAt": 1_784_000_000_000,
                "degraded": False,
                "rows": [
                    {
                        "positionId": 3,
                        "trader": "GABC",
                        "asset": "BTC",
                        "direction": 0,
                        "size": "1000000000",
                        "pnl": "50000000",
                        "score": "25000",
                        "rank": 1,
                        "quintile": 1,
                    }
                ],
            },
        )
    )
    async with make_client(rec) as client:
        res = await client.adl.queue("btc", trader="GABC")
    url = rec.requests[0].url
    assert url.path == "/v1/adl/queue"
    assert url.params["asset"] == "BTC"
    assert url.params["trader"] == "GABC"
    assert res.degraded is False
    assert res.rows[0].quintile == 1


async def test_account_positions_returns_full_shape() -> None:
    rec = Recorder((200, {"positions": [POSITION], "events": [EVENT]}))
    async with make_client(rec, credentials=CREDS) as client:
        res = await client.account.positions()
    request = rec.requests[0]
    assert request.url.path == "/v1/account/me/positions"
    assert request.headers["authorization"] == "Bearer nk_x:shh"
    # Both halves of the response survive; the events only shape is gone.
    assert len(res.positions) == 1
    assert res.positions[0].entry_price == "600000000000"
    assert res.positions[0].adl_quintile is None
    assert len(res.events) == 1
    assert res.events[0].topic == "position_opened"


async def test_account_events_and_orders_forward_before_ts() -> None:
    rec = Recorder((200, {"events": []}), (200, {"events": []}))
    async with make_client(rec, credentials=CREDS) as client:
        await client.account.events(topic="position_closed", before_ts=1_784_000_000, limit=10)
        await client.account.orders(before_ts=1_784_000_000, limit=5)
    ev_url = rec.requests[0].url
    assert ev_url.path == "/v1/account/me/events"
    assert ev_url.params["topic"] == "position_closed"
    assert ev_url.params["before_ts"] == "1784000000"
    ord_url = rec.requests[1].url
    assert ord_url.path == "/v1/account/me/orders"
    assert ord_url.params["before_ts"] == "1784000000"
    assert ord_url.params["limit"] == "5"


async def test_events_list_forwards_before_ts() -> None:
    rec = Recorder((200, {"events": []}))
    async with make_client(rec) as client:
        await client.events.list(before_ts=1_784_000_000, limit=20)
    url = rec.requests[0].url
    assert url.path == "/v1/events"
    assert url.params["before_ts"] == "1784000000"
    assert url.params["limit"] == "20"


async def test_account_volume_is_public() -> None:
    rec = Recorder((200, {"address": "GABC", "volume14d": "123450000000"}))
    async with make_client(rec) as client:
        res = await client.account.volume("GABC")
    request = rec.requests[0]
    assert request.url.path == "/v1/account/volume"
    assert request.url.params["address"] == "GABC"
    assert "authorization" not in request.headers
    assert res.volume_14d == "123450000000"


async def test_account_shortfall_supported_flag() -> None:
    rec = Recorder((200, {"address": "GABC", "owed": "0", "reserve": "0", "supported": False}))
    async with make_client(rec) as client:
        res = await client.account.shortfall("GABC")
    assert rec.requests[0].url.path == "/v1/account/shortfall"
    # supported False means the zeros are placeholders, not facts.
    assert res.supported is False
    assert res.owed == "0"


async def test_transport_503_raises_service_unavailable_with_retry_hint() -> None:
    rec = Recorder(
        (503, {"error": "try_again_later", "retryable": True}, {"retry-after": "2"})
    )
    async with make_client(rec) as client:
        with pytest.raises(ServiceUnavailableError) as exc_info:
            await client.markets.list()
    assert exc_info.value.retry_after_sec == 2
    assert exc_info.value.code == "try_again_later"
