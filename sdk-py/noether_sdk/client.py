"""Top-level NoetherClient — composes the per-resource sub-clients."""

from __future__ import annotations
from typing import Awaitable, Callable

import httpx

from .transport import Credentials, Transport
from .sub.account import AccountApi
from .sub.events import EventsApi
from .sub.health import HealthApi
from .sub.keys import KeysApi
from .sub.markets import MarketsApi
from .sub.oracle import OracleApi
from .sub.orders import OrdersApi
from .sub.positions import PositionsApi
from .sub.referral import ReferralApi
from .sub.tx import TxApi
from .sub.vaults import VaultsApi
from .models import PreparedTransaction, SubmittedTx


XdrSigner = Callable[[str], str | Awaitable[str]]


class NoetherClient:
    """Async client; mirrors the TypeScript SDK's (noether-sdk) NoetherClient surface."""

    def __init__(
        self,
        base_url: str,
        *,
        credentials: Credentials | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._credentials = credentials
        self._transport = Transport(self.base_url, client=client)

        self.health = HealthApi(self._transport)
        self.markets = MarketsApi(self._transport)
        self.oracle = OracleApi(self._transport)
        self.events = EventsApi(self._transport)
        self.keys = KeysApi(self._transport, credentials)
        self.account = AccountApi(self._transport, credentials)
        self.orders = OrdersApi(self._transport, credentials)
        self.positions = PositionsApi(self._transport)
        self.tx = TxApi(self._transport, credentials)
        self.vaults = VaultsApi(self._transport)
        self.referral = ReferralApi(self._transport, credentials)

    @property
    def has_auth(self) -> bool:
        return self._credentials is not None

    def with_credentials(self, credentials: Credentials) -> "NoetherClient":
        """Return a fresh client bound to the given credentials. The original is untouched."""
        return NoetherClient(self.base_url, credentials=credentials)

    async def execute_trade(
        self,
        request: dict,
        signer: XdrSigner,
        *,
        poll_timeout_ms: int | None = None,
    ) -> tuple[PreparedTransaction, SubmittedTx]:
        """One-shot prepare → caller signs → submit. Mirrors TS executeTrade."""
        if not self.has_auth:
            raise RuntimeError("execute_trade requires an authenticated client")
        prepared = await self.orders.prepare(request)
        signed = signer(prepared.xdr)
        if hasattr(signed, "__await__"):
            signed = await signed  # type: ignore[assignment]
        submitted = await self.tx.submit(signed_xdr=signed, poll_timeout_ms=poll_timeout_ms)
        return prepared, submitted

    async def aclose(self) -> None:
        await self._transport.aclose()

    async def __aenter__(self) -> "NoetherClient":
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.aclose()
