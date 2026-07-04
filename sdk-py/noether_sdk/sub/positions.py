from __future__ import annotations

from ..models import OpenPositionRow
from ..transport import Transport


class PositionsApi:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    async def open(self, *, trader: str | None = None) -> list[OpenPositionRow]:
        """Public — currently open positions, optionally filtered by trader."""
        body = await self._transport.request(
            "GET", "/v1/positions/open", params={"trader": trader}
        )
        return [OpenPositionRow.model_validate(p) for p in body.get("positions", [])]
