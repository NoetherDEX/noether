"""Pydantic models mirroring every gateway response shape."""

from __future__ import annotations
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _Base(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", alias_generator=to_camel)


# ─── system ────────────────────────────────────────────────────────────────


class HealthStatus(_Base):
    status: str
    uptime: float
    version: str


# ─── market data ───────────────────────────────────────────────────────────


class Asset(_Base):
    symbol: str
    name: str
    decimals: int


class OracleSnapshot(_Base):
    asset: str
    price: str
    price_float: float
    timestamp: int


class MarketSummary(_Base):
    asset: Asset
    oracle: OracleSnapshot


# ─── events ────────────────────────────────────────────────────────────────


class RawEvent(_Base):
    event_id: str
    contract_id: str
    topic: str
    ledger: int
    ledger_close_ts: int
    tx_hash: str
    payload: dict
    inserted_at: int


# ─── keys / account ────────────────────────────────────────────────────────


class IssuedChallenge(_Base):
    challenge_hex: str
    expires_at: int


class IssuedApiKey(_Base):
    key_id: str
    secret: str
    owner: str
    tier: Literal["standard", "market_maker"]
    created_at: int


class ApiKeyRecord(_Base):
    key_id: str
    owner: str
    tier: Literal["standard", "market_maker"]
    label: str | None = None
    created_at: int
    last_used_at: int | None = None
    revoked_at: int | None = None


class BetaStatus(_Base):
    gated: bool
    allowed: bool


class AccountIdentity(_Base):
    owner: str
    tier: Literal["standard", "market_maker"]
    key_id: str


# ─── orders / tx ───────────────────────────────────────────────────────────


class PreparedTransaction(_Base):
    op: str
    trader: str
    xdr: str
    min_resource_fee: str | None = None


class SubmittedTx(_Base):
    hash: str
    status: Literal["SUCCESS", "FAILED", "PENDING", "NOT_FOUND"]
    ledger: int | None = None


# ─── positions ─────────────────────────────────────────────────────────────


class OpenPositionRow(_Base):
    position_id: int
    trader: str
    asset: str
    direction: int
    size: str
    entry_price: str
    opened_at: int
    opened_tx_hash: str


class OrderEventRow(_Base):
    """One order_placed event folded to its lifecycle status (GET /v1/orders/open).

    Carries only what the event carries — hydrate asset/direction/size
    on-chain via get_order for the ids returned.
    """

    order_id: int
    trader: str
    trigger_price: str
    status: Literal["open", "executed", "cancelled"]
    ledger: int
    ts: int
    tx_hash: str


# ─── vaults ────────────────────────────────────────────────────────────────


class VaultRow(_Base):
    id: int
    leader: str
    name: str
    created_at: int
    total_usdc: str
    circulating_shares: str
    hwm_nav: str
    realized_pnl: str
    leader_shares: str
    profit_share_bps: int
    paused: bool
    updated_at: int


class VaultActivityRow(_Base):
    id: int
    vault_id: int
    principal: str
    amount: str
    shares: str | None = None
    ledger: int
    ts: int
    tx_hash: str


class VaultTradeRow(_Base):
    id: int
    vault_id: int
    position_id: str
    action: Literal["open", "close"]
    leader: str
    collateral: str
    pnl: str | None = None
    ledger: int
    ts: int
    tx_hash: str


# ─── referral ──────────────────────────────────────────────────────────────


class ReferrerRow(_Base):
    referrer: str
    code: str
    created_at: int
    referred_count: int
    total_volume_generated: str
    total_earned: str
    claimable: str
    updated_at: int


class ReferralBindingRow(_Base):
    referee: str
    referrer: str
    code: str
    bound_at: int
    tx_hash: str


class ReferralTradeRow(_Base):
    id: int
    referee: str
    referrer: str
    original_fee: str
    discount: str
    payout: str
    ledger: int
    ts: int
    tx_hash: str


class ReferralClaimRow(_Base):
    id: int
    referrer: str
    amount: str
    ledger: int
    ts: int
    tx_hash: str


class ReferralMeResponse(_Base):
    self_: ReferrerRow | None = None
    binding: ReferralBindingRow | None = None

    model_config = ConfigDict(
        populate_by_name=True,
        extra="ignore",
    )
