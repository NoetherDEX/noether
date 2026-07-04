from typing import TYPE_CHECKING, Awaitable, Callable

from ..errors import AuthError
from ..models import ApiKeyRecord, BetaStatus, IssuedApiKey, IssuedChallenge
from ..transport import Credentials, Transport

if TYPE_CHECKING:  # pragma: no cover - typing only
    from stellar_sdk import TransactionEnvelope


ChallengeSigner = Callable[[bytes], bytes | Awaitable[bytes]]

CHALLENGE_DATA_NAME = "noether-api auth"
TESTNET_PASSPHRASE = "Test SDF Network ; September 2015"


def _require_stellar_sdk():
    try:
        import stellar_sdk
    except ImportError as exc:  # pragma: no cover - exercised via the stellar extra
        raise RuntimeError(
            "keys.create requires the stellar-sdk package — install via "
            "`pip install 'noether-sdk[stellar]'`."
        ) from exc
    return stellar_sdk


def build_challenge_tx(
    address: str,
    challenge_hex: str,
    network_passphrase: str = TESTNET_PASSPHRASE,
) -> "TransactionEnvelope":
    """Wrap the gateway challenge as the value of a manageData op on a
    sequence-0 placeholder transaction (random source account, zero fee).

    This is the exact SEP-10-style envelope the gateway verifies:
    op[0] must be a manageData carrying the challenge bytes, and one of
    the attached signatures must verify against ``tx.hash()``.
    """
    stellar = _require_stellar_sdk()
    builder = stellar.TransactionBuilder(
        source_account=stellar.Account(stellar.Keypair.random().public_key, 0),
        network_passphrase=network_passphrase,
        base_fee=0,
    )
    builder.append_manage_data_op(
        data_name=CHALLENGE_DATA_NAME,
        data_value=bytes.fromhex(challenge_hex),
        source=address,
    )
    builder.add_time_bounds(0, 0)
    return builder.build()


class KeysApi:
    def __init__(self, transport: Transport, credentials: Credentials | None) -> None:
        self._transport = transport
        self._credentials = credentials

    async def beta_status(self, address: str | None = None) -> BetaStatus:
        """Public — whether key issuance is closed-beta gated (and if `address` is allowed)."""
        body = await self._transport.request(
            "GET", "/v1/keys/beta-status", params={"address": address}
        )
        return BetaStatus.model_validate(body)

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
        signed_xdr: str,
        label: str | None = None,
    ) -> IssuedApiKey:
        """Exchange a SEP-10-style signed XDR for an API key. The server's
        `signature` field carries the full base64-encoded signed
        transaction (legacy field name; kept for wire compatibility).
        """
        body = await self._transport.request(
            "POST",
            "/v1/keys",
            json={
                "address": address,
                "challenge": challenge,
                "signature": signed_xdr,
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
        network_passphrase: str = TESTNET_PASSPHRASE,
    ) -> IssuedApiKey:
        """Convenience: request a challenge, wrap it as a manageData op on
        a placeholder transaction, ask the caller's signer to sign the tx
        hash, assemble a signed XDR, exchange it for an API key.

        This matches the gateway's verification path:
          1. Server parses the XDR.
          2. Asserts op[0] is manageData carrying the issued challenge.
          3. Verifies any tx signature against ``tx.hash()`` with the
             address's pubkey.

        The passphrase must match the gateway's network — pass the
        public-network passphrase for mainnet deployments.
        """
        stellar = _require_stellar_sdk()
        challenge = await self.request_challenge(address)
        tx = build_challenge_tx(address, challenge.challenge_hex, network_passphrase)
        sig = signer(tx.hash())
        if hasattr(sig, "__await__"):
            sig = await sig  # type: ignore[assignment]
        hint = stellar.Keypair.from_public_key(address).signature_hint()
        tx.signatures.append(stellar.DecoratedSignature(hint, bytes(sig)))
        return await self.exchange(
            address=address,
            challenge=challenge.challenge_hex,
            signed_xdr=tx.to_xdr(),
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
