from ..models import MarketSummary
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
