from ..models import OracleHealth, OracleSnapshot
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

    async def health(self) -> OracleHealth:
        """Public. Per source oracle health: on chain price age per asset plus
        the keeper's last self report. Check the status field: ok, degraded
        or down. The gateway's strict query flag (a 503 for uptime monitors
        when not ok) is deliberately not exposed here; read status instead.
        """
        body = await self._transport.request("GET", "/v1/oracle/health")
        return OracleHealth.model_validate(body)
