from ..models import CandlesResponse, MarketStatsResponse, MarketSummary
from ..transport import Transport


class MarketsApi:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    async def list(self) -> list[MarketSummary]:
        body = await self._transport.request("GET", "/v1/markets")
        return [MarketSummary.model_validate(m) for m in body.get("markets", [])]

    async def get(self, asset: str) -> MarketSummary:
        body = await self._transport.request("GET", f"/v1/markets/{asset.upper()}")
        return MarketSummary.model_validate(body)

    async def stats(self) -> MarketStatsResponse:
        """Public. Per asset open interest and 24h volume for every supported
        market, plus the protocol solvency summary."""
        body = await self._transport.request("GET", "/v1/markets/stats")
        return MarketStatsResponse.model_validate(body)

    async def candles(
        self,
        asset: str,
        *,
        interval: str | None = None,
        limit: int | None = None,
    ) -> CandlesResponse:
        """Public. OHLC candles for an asset, oldest first.

        interval is one of 1m, 5m, 15m, 1h, 4h, 1d, 1w (gateway default 1h);
        limit is capped at 1000 (gateway default 500). Check the source
        field: the gateway falls back to Binance reference candles when the
        venue has none yet for that asset and interval.
        """
        body = await self._transport.request(
            "GET",
            "/v1/candles",
            params={"asset": asset.upper(), "interval": interval, "limit": limit},
        )
        return CandlesResponse.model_validate(body)
