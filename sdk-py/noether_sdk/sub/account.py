from ..errors import AuthError
from ..models import (
    AccountIdentity,
    AccountPositionsResponse,
    AccountShortfall,
    AccountVolume,
    RawEvent,
)
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
        self,
        *,
        topic: str | None = None,
        before_ts: int | None = None,
        limit: int | None = None,
    ) -> list[RawEvent]:
        """Decoded contract events referencing the owner address.

        before_ts is a cursor: only events with a ledger close time strictly
        below it are returned.
        """
        self._require_auth()
        body = await self._transport.request(
            "GET",
            "/v1/account/me/events",
            params={"topic": topic, "before_ts": before_ts, "limit": limit},
            credentials=self._credentials,
        )
        return [RawEvent.model_validate(e) for e in body.get("events", [])]

    async def positions(self) -> AccountPositionsResponse:
        """Open positions for the authenticated owner plus the owner's
        position events. Returns the full route shape; earlier SDK versions
        dropped the positions projection and returned only the events list.
        """
        self._require_auth()
        body = await self._transport.request(
            "GET", "/v1/account/me/positions", credentials=self._credentials
        )
        return AccountPositionsResponse.model_validate(body)

    async def orders(
        self,
        *,
        before_ts: int | None = None,
        limit: int | None = None,
    ) -> list[RawEvent]:
        """Order related events for the owner, newest first.

        before_ts is a cursor: only events with a ledger close time strictly
        below it are returned.
        """
        self._require_auth()
        body = await self._transport.request(
            "GET",
            "/v1/account/me/orders",
            params={"before_ts": before_ts, "limit": limit},
            credentials=self._credentials,
        )
        return [RawEvent.model_validate(e) for e in body.get("events", [])]

    async def volume(self, address: str) -> AccountVolume:
        """Public. Trailing 14 day traded notional for any wallet; needs no API key."""
        body = await self._transport.request(
            "GET", "/v1/account/volume", params={"address": address}
        )
        return AccountVolume.model_validate(body)

    async def shortfall(self, address: str) -> AccountShortfall:
        """Public. Claimable shortfall owed to a wallet; needs no API key.

        When supported is False the zeros are placeholders, not facts.
        """
        body = await self._transport.request(
            "GET", "/v1/account/shortfall", params={"address": address}
        )
        return AccountShortfall.model_validate(body)

    def _require_auth(self) -> None:
        if self._credentials is None:
            raise AuthError(
                "account.* requires an authenticated client",
                status=401,
                body=None,
                url="/v1/account/me",
            )
