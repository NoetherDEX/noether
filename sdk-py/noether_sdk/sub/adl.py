from __future__ import annotations

from ..models import AdlQueueResult
from ..transport import Transport


class AdlApi:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    async def queue(self, asset: str, *, trader: str | None = None) -> AdlQueueResult:
        """Public. Advisory auto deleveraging queue for one asset: positive
        pnl positions ranked by priority, refreshed on a short cache.

        Pass trader to keep only that wallet's rows. degraded True means the
        ranking could not be computed this window: treat the queue as
        unknown, never as nobody at risk.
        """
        body = await self._transport.request(
            "GET", "/v1/adl/queue", params={"asset": asset.upper(), "trader": trader}
        )
        return AdlQueueResult.model_validate(body)
