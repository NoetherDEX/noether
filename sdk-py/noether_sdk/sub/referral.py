from ..errors import AuthError, NotFoundError
from ..models import (
    ReferralBindingRow,
    ReferralClaimRow,
    ReferralMeResponse,
    ReferralTradeRow,
    ReferrerRow,
)
from ..transport import Credentials, Transport


class ReferralApi:
    def __init__(self, transport: Transport, credentials: Credentials | None) -> None:
        self._transport = transport
        self._credentials = credentials

    async def lookup_code(self, code: str) -> ReferrerRow | None:
        try:
            body = await self._transport.request(
                "GET", "/v1/referral/lookup", params={"code": code}
            )
        except NotFoundError:
            return None
        return ReferrerRow.model_validate(body)

    async def info(self, address: str) -> ReferralMeResponse | None:
        """Public — referral state for any address (same shape as `me()`).

        Returns None if the address has never registered a code.
        """
        try:
            body = await self._transport.request(
                "GET", "/v1/referral/info", params={"address": address}
            )
        except NotFoundError:
            return None
        return self._to_me_response(body)

    async def me(self) -> ReferralMeResponse:
        self._require_auth()
        body = await self._transport.request("GET", "/v1/referral/me", credentials=self._credentials)
        return self._to_me_response(body)

    async def trades(self, *, limit: int | None = None) -> list[ReferralTradeRow]:
        self._require_auth()
        body = await self._transport.request(
            "GET",
            "/v1/referral/me/trades",
            params={"limit": limit},
            credentials=self._credentials,
        )
        return [ReferralTradeRow.model_validate(t) for t in body.get("trades", [])]

    async def claims(self, *, limit: int | None = None) -> list[ReferralClaimRow]:
        self._require_auth()
        body = await self._transport.request(
            "GET",
            "/v1/referral/me/claims",
            params={"limit": limit},
            credentials=self._credentials,
        )
        return [ReferralClaimRow.model_validate(c) for c in body.get("claims", [])]

    @staticmethod
    def _to_me_response(body: dict) -> ReferralMeResponse:
        # the gateway returns { self, binding } — pydantic v2 + alias handles it.
        return ReferralMeResponse(
            self_=ReferrerRow.model_validate(body["self"]) if body.get("self") else None,
            binding=ReferralBindingRow.model_validate(body["binding"]) if body.get("binding") else None,
        )

    def _require_auth(self) -> None:
        if self._credentials is None:
            raise AuthError(
                "referral.me / trades / claims require an authenticated client",
                status=401,
                body=None,
                url="/v1/referral/me",
            )
