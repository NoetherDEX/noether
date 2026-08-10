from __future__ import annotations

from ..models import TradeRow
from ..transport import Transport


class TradesApi:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    async def list(
        self,
        *,
        trader: str | None = None,
        asset: str | None = None,
        before_ts: int | None = None,
        limit: int | None = None,
        include_opens: bool | None = None,
    ) -> list[TradeRow]:
        """Public. Recent trades, newest first.

        before_ts is a cursor: only rows with ts strictly below it are
        returned, so page backwards by passing the oldest row's ts on the
        next call. limit is capped at 200 (gateway default 50). Pass
        include_opens=True to also receive position_opened rows as kind
        open.
        """
        body = await self._transport.request(
            "GET",
            "/v1/trades",
            params={
                "trader": trader,
                "asset": asset.upper() if asset else None,
                "before_ts": before_ts,
                "limit": limit,
                "include_opens": include_opens,
            },
        )
        return [TradeRow.model_validate(t) for t in body.get("trades", [])]
