from ..errors import AuthError
from ..models import AccountIdentity, RawEvent
from ..transport import Credentials, Transport


class AccountApi:
    def __init__(self, transport: Transport, credentials: Credentials | None) -> None:
        self._transport = transport
        self._credentials = credentials

    async def me(self) -> AccountIdentity:
        self._require_auth()
        body = await self._transport.request("GET", "/v1/account/me", credentials=self._credentials)
        return AccountIdentity.model_validate(body)

    async def events(
        self, *, topic: str | None = None, limit: int | None = None
    ) -> list[RawEvent]:
        self._require_auth()
        body = await self._transport.request(
            "GET",
            "/v1/account/me/events",
            params={"topic": topic, "limit": limit},
            credentials=self._credentials,
        )
        return [RawEvent.model_validate(e) for e in body.get("events", [])]

    async def positions(self) -> list[RawEvent]:
        self._require_auth()
        body = await self._transport.request(
            "GET", "/v1/account/me/positions", credentials=self._credentials
        )
        return [RawEvent.model_validate(e) for e in body.get("events", [])]

    async def orders(self) -> list[RawEvent]:
        self._require_auth()
        body = await self._transport.request(
            "GET", "/v1/account/me/orders", credentials=self._credentials
        )
        return [RawEvent.model_validate(e) for e in body.get("events", [])]

    def _require_auth(self) -> None:
        if self._credentials is None:
            raise AuthError(
                "account.* requires an authenticated client",
                status=401,
                body=None,
                url="/v1/account/me",
            )
