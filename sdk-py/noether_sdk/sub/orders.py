from typing import Any

from ..errors import AuthError
from ..models import OrderEventRow, PreparedTransaction
from ..transport import Credentials, Transport


def _stringify_bigint(value: int | str | bytes) -> str:
    if isinstance(value, str):
        return value
    return str(int(value))


def serialise_request(req: dict[str, Any]) -> dict[str, Any]:
    """Coerce bigint-shaped fields to decimal strings the gateway expects."""
    out = dict(req)
    for key in ("collateral", "trigger_price", "limit_price"):
        if key in out:
            out[key] = _stringify_bigint(out[key])
    for key in ("position_id", "order_id"):
        if key in out:
            out[key] = _stringify_bigint(out[key])
    # Camel-case the keys the gateway expects (mirrors the TS body shape).
    rename = {
        "trigger_price": "triggerPrice",
        "limit_price": "limitPrice",
        "position_id": "positionId",
        "order_id": "orderId",
        "trigger_condition": "triggerCondition",
        "trailing_percent_bps": "trailingPercentBps",
        "slippage_tolerance_bps": "slippageToleranceBps",
    }
    return {rename.get(k, k): v for k, v in out.items()}


class OrdersApi:
    def __init__(self, transport: Transport, credentials: Credentials | None) -> None:
        self._transport = transport
        self._credentials = credentials

    async def open(
        self,
        *,
        trader: str | None = None,
        status: str | None = None,
        limit: int | None = None,
    ) -> list[OrderEventRow]:
        """Public — orders folded to open/executed/cancelled, newest first.

        Mirrors GET /v1/orders/open: rows carry only (orderId, trader,
        triggerPrice, status). Default status='open'; pass status='all' for
        the executed/cancelled history. Hydrate asset/direction/size on-chain
        via get_order for the ids returned.
        """
        body = await self._transport.request(
            "GET",
            "/v1/orders/open",
            params={"trader": trader, "status": status, "limit": limit},
        )
        return [OrderEventRow.model_validate(o) for o in body.get("orders", [])]

    async def prepare(self, request: dict[str, Any]) -> PreparedTransaction:
        if self._credentials is None:
            raise AuthError(
                "orders.prepare requires an authenticated client",
                status=401,
                body=None,
                url="/v1/orders/prepare",
            )
        body = await self._transport.request(
            "POST",
            "/v1/orders/prepare",
            json=serialise_request(request),
            credentials=self._credentials,
        )
        return PreparedTransaction.model_validate(body)
