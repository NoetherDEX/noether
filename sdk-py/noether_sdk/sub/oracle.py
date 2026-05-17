from ..models import OracleSnapshot
from ..transport import Transport


class OracleApi:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    async def get_price(self, asset: str) -> OracleSnapshot:
        body = await self._transport.request("GET", f"/v1/markets/{asset.upper()}/price")
        return OracleSnapshot.model_validate(body)

    async def get_prices(self) -> list[OracleSnapshot]:
        body = await self._transport.request("GET", "/v1/oracle/prices")
        return [OracleSnapshot.model_validate(p) for p in body.get("prices", [])]
