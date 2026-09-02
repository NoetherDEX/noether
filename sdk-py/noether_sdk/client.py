"""Top-level NoetherClient — composes the per-resource sub-clients."""

from __future__ import annotations
import asyncio
from typing import Any, Awaitable, Callable

import httpx

from .errors import ApiError
from .retry import classify_submit_failure
from .transport import Credentials, Transport
from .sub.account import AccountApi
from .sub.adl import AdlApi
from .sub.events import EventsApi
from .sub.health import HealthApi
from .sub.keys import KeysApi
from .sub.markets import MarketsApi
from .sub.oracle import OracleApi
from .sub.orders import OrdersApi
from .sub.positions import PositionsApi
from .sub.referral import ReferralApi
from .sub.trades import TradesApi
from .sub.tx import TxApi
from .sub.vaults import VaultsApi
from .models import PreparedTransaction, SubmittedTx


XdrSigner = Callable[[str], str | Awaitable[str]]


def _as_dict(value: object) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


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
        self.trades = TradesApi(self._transport)
        self.adl = AdlApi(self._transport)
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
        retry_on_stale_footprint: bool = True,
        retry_delay_s: float = 2.0,
    ) -> tuple[PreparedTransaction, SubmittedTx]:
        """One-shot prepare → caller signs → submit. Mirrors TS executeTrade.

        Soroban freezes a transaction's footprint at simulation; when the
        network state moves before the apply (a vault bucket refilled by
        someone else's trade, the RPC queue full) the first attempt fails
        without a contract revert. That class gets ONE automatic rebuild:
        re-prepare against fresh state, ask the signer again, resubmit. A
        contract revert is never retried, and neither is a generic 503 (the
        first attempt may be live). ``retry_on_stale_footprint=False`` opts
        out; ``retry_delay_s`` is the pause before resubmitting after a full
        RPC queue.
        """
        if not self.has_auth:
            raise RuntimeError("execute_trade requires an authenticated client")
        attempt = 0
        while True:
            prepared = await self.orders.prepare(request)
            signed = signer(prepared.xdr)
            if hasattr(signed, "__await__"):
                signed = await signed  # type: ignore[assignment]
            try:
                submitted = await self.tx.submit(signed_xdr=signed, poll_timeout_ms=poll_timeout_ms)
            except ApiError as exc:
                body = exc.body if isinstance(exc.body, dict) else {}
                cls = classify_submit_failure(
                    http_status=exc.status,
                    error_code=exc.code,
                    host_error=_as_dict(body.get("hostError")),
                    contract_error=_as_dict(body.get("contractError")),
                    tx_result_code=body.get("txResultCode") if isinstance(body.get("txResultCode"), str) else None,
                )
                if retry_on_stale_footprint and attempt == 0 and cls != "none":
                    attempt += 1
                    if cls == "try_again_later":
                        await asyncio.sleep(retry_delay_s)
                    continue
                raise
            cls = classify_submit_failure(
                status=submitted.status,
                contract_error=submitted.contract_error.model_dump() if submitted.contract_error else None,
                host_error=submitted.host_error.model_dump() if submitted.host_error else None,
                tx_result_code=submitted.tx_result_code,
            )
            if retry_on_stale_footprint and attempt == 0 and cls == "stale_footprint":
                attempt += 1
                continue
            return prepared, submitted

    async def aclose(self) -> None:
        await self._transport.aclose()

    async def __aenter__(self) -> "NoetherClient":
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.aclose()
