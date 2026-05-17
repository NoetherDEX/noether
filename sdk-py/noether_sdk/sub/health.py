from ..models import HealthStatus
from ..transport import Transport


class HealthApi:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    async def ping(self) -> HealthStatus:
        body = await self._transport.request("GET", "/v1/health")
        return HealthStatus.model_validate(body)
