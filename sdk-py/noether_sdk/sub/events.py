from ..models import RawEvent
from ..transport import Transport


class EventsApi:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    async def list(
        self,
        *,
        topic: str | None = None,
        contract: str | None = None,
        from_ledger: int | None = None,
        to_ledger: int | None = None,
        limit: int | None = None,
    ) -> list[RawEvent]:
        params = {
            "topic": topic,
            "contract": contract,
            "from_ledger": from_ledger,
            "to_ledger": to_ledger,
            "limit": limit,
        }
        body = await self._transport.request("GET", "/v1/events", params=params)
        return [RawEvent.model_validate(e) for e in body.get("events", [])]
