from typing import Awaitable, Callable

from ..errors import AuthError
from ..models import ApiKeyRecord, IssuedApiKey, IssuedChallenge
from ..transport import Credentials, Transport


ChallengeSigner = Callable[[bytes], bytes | Awaitable[bytes]]


class KeysApi:
    def __init__(self, transport: Transport, credentials: Credentials | None) -> None:
        self._transport = transport
        self._credentials = credentials

    async def request_challenge(self, address: str) -> IssuedChallenge:
        body = await self._transport.request(
            "POST", "/v1/keys/challenge", json={"address": address}
        )
        return IssuedChallenge.model_validate(body)

    async def exchange(
        self,
        *,
        address: str,
        challenge: str,
        signature_hex: str,
        label: str | None = None,
    ) -> IssuedApiKey:
        body = await self._transport.request(
            "POST",
            "/v1/keys",
            json={
                "address": address,
                "challenge": challenge,
                "signature": signature_hex,
                "label": label,
            },
        )
        return IssuedApiKey.model_validate(body)

    async def create(
        self,
        *,
        address: str,
        signer: ChallengeSigner,
        label: str | None = None,
    ) -> IssuedApiKey:
        challenge = await self.request_challenge(address)
        raw = bytes.fromhex(challenge.challenge_hex)
        sig = signer(raw)
        if hasattr(sig, "__await__"):
            sig = await sig  # type: ignore[assignment]
        return await self.exchange(
            address=address,
            challenge=challenge.challenge_hex,
            signature_hex=sig.hex() if isinstance(sig, (bytes, bytearray)) else str(sig),
            label=label,
        )

    async def list(self) -> list[ApiKeyRecord]:
        self._require_auth()
        body = await self._transport.request("GET", "/v1/keys", credentials=self._credentials)
        return [ApiKeyRecord.model_validate(k) for k in body.get("keys", [])]

    async def revoke(self, key_id: str) -> None:
        self._require_auth()
        await self._transport.request(
            "DELETE", f"/v1/keys/{key_id}", credentials=self._credentials
        )

    def _require_auth(self) -> None:
        if self._credentials is None:
            raise AuthError(
                "keys.list / keys.revoke require an authenticated client",
                status=401,
                body=None,
                url="/v1/keys",
            )
