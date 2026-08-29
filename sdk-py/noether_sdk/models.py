"""Pydantic models mirroring every gateway response shape."""

from __future__ import annotations
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
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


CapacityBinding = Literal["aggregate", "side", "skew", "liquidity", "maxPosition"]
"""Which vault gate binds first if an order grew by one more unit (L1-13)."""


class AssetCapacity(_Base):
    """Pool-capacity headroom for one market (L1-13).

    The largest notional the vault accepts for a new long / short right now,
    with the chain inputs behind it. Advisory: the contract enforces (#82 /
    #89). Amounts are i128 decimal strings with 7 decimal USDC precision.
    Present on ``AssetStats`` only when the gateway's chain read succeeded.
    """

    headroom_long: str
    headroom_short: str
    binding_long: CapacityBinding
    binding_short: CapacityBinding
    oi_long: str
    oi_short: str
    net_skew: str
    side_cap: str
    skew_cap: str
    asset_cap_bps: int
    cap_abs: str
    skew_cap_bps: int
    max_position_size: str | None = None


class PoolCapacity(_Base):
    """Vault wide capacity (L1-13); present only when the chain read succeeded."""

    aum: str
    reserved_payout: str
    usdc_balance: str
    shortfall_reserve: str
    reserve_cap_bps: int
    reserve_cap: str
    aggregate_headroom: str
    aggregate_binding: Literal["aggregate", "liquidity"]
    as_of_ledger: int | None = None
    ts: int
    stale: bool


class AssetStats(_Base):
    """Per asset open interest and 24h volume (GET /v1/markets/stats).

    Amounts are i128 decimal strings with 7 decimal USDC precision.
    ``capacity`` is the L1-13 headroom block — ``None`` (never zeros) when the
    gateway could not read the chain.
    """

    asset: str
    open_interest_long: str
    open_interest_short: str
    open_interest_net: str
    open_positions: int
    volume_24h: str = Field(alias="volume24h")
    capacity: AssetCapacity | None = None


class SolvencyStats(_Base):
    """Market scoped lifetime bad debt: buffer absorbed vs LP absorbed."""

    cumulative_bad_debt_covered: str
    cumulative_bad_debt_lp_absorbed: str
    bad_debt_events: int


class MarketCustody(_Base):
    """Market custody invariant as last self-reported by the keeper.

    The USDC the market contract holds vs the collateral it holds for traders
    (live isolated collateral + cross pools + pending entry-order escrow).
    ``deficit`` must be ``"0"``; anything else means payouts are about to fail.
    ``stale`` is True when the report is older than 5 minutes (unknown, not
    healthy). 7 decimal USDC strings.
    """

    market_usdc_balance: str
    tracked_custody: str
    isolated_collateral: str
    cross_balances: str
    order_escrow: str
    deficit: str
    positions: int
    as_of: int
    age_ms: int
    stale: bool


class MarketStatsResponse(_Base):
    stats: list[AssetStats]
    solvency: SolvencyStats
    pool: PoolCapacity | None = None
    custody: MarketCustody | None = None


class CandlePoint(_Base):
    """One OHLC bucket; prices are floats, time is the bucket start in unix seconds."""

    time: int
    open: float
    high: float
    low: float
    close: float


class CandlesResponse(_Base):
    """GET /v1/candles: candles oldest first; source says whether the gateway
    served native Noeracle candles or fell back to Binance reference candles."""

    candles: list[CandlePoint]
    source: Literal["noeracle", "binance"]


class OracleAssetHealth(_Base):
    """Per asset entry of the oracle health report; None fields mean the read failed."""

    asset: str
    price_float: float | None = None
    age_sec: int | None = None
    stale: bool
    error: str | None = None


class OracleOnchainHealth(_Base):
    stale_after_sec: int
    stale_count: int
    assets: list[OracleAssetHealth]


class OracleKeeperHealth(_Base):
    configured: bool
    age_ms: int | None = None
    stale: bool
    last_report: dict | None = None


class OracleHealth(_Base):
    """GET /v1/oracle/health: on chain price age per asset plus the keeper self report."""

    status: Literal["ok", "degraded", "down"]
    onchain: OracleOnchainHealth
    keeper: OracleKeeperHealth


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


class AccountVolume(_Base):
    """GET /v1/account/volume: trailing 14 day traded notional for a wallet
    as an i128 decimal string with 7 decimal USDC precision."""

    address: str
    volume_14d: str = Field(alias="volume14d")


class AccountShortfall(_Base):
    """GET /v1/account/shortfall: USDC the vault still owes this trader plus
    the global repayment reserve. When supported is False the zeros are
    placeholders, not facts: hide the surface instead of rendering them."""

    address: str
    owed: str
    reserve: str
    supported: bool


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
    # Advisory auto deleveraging quintile 1..5 (1 = first deleveraged);
    # None when not queued or unavailable. Served by GET /v1/positions/open,
    # absent on the account positions feed.
    adl_quintile: int | None = None


class AccountPositionsResponse(_Base):
    """GET /v1/account/me/positions: open positions from the indexer
    projection plus the owner's position events."""

    positions: list[OpenPositionRow]
    events: list[RawEvent]


class TradeRow(_Base):
    """One row from GET /v1/trades. Realized rows join asset, direction,
    size and entry price from the matching open event; those fields are
    None when the open predates the indexer history. Cross margin account
    liquidations carry None position fields and the account total as pnl.
    """

    position_id: int | None = None
    trader: str
    kind: Literal["open", "close", "liquidation", "cross_liquidation", "adl"]
    asset: str | None = None
    direction: int | None = None
    size: str | None = None
    entry_price: str | None = None
    close_price: str | None = None
    pnl: str | None = None
    ledger: int
    ts: int
    tx_hash: str


class AdlQueueRow(_Base):
    """One candidate in the advisory auto deleveraging queue.

    rank 1 is first to be deleveraged; quintile is 1..5 among positive
    pnl positions with 1 the highest priority.
    """

    position_id: int
    trader: str
    asset: str
    direction: int
    size: str
    pnl: str
    score: str
    rank: int
    quintile: int


class AdlQueueResult(_Base):
    """GET /v1/adl/queue. degraded True means the ranking could not be
    computed this window: treat the queue as unknown, never as empty."""

    asset: str
    updated_at: int
    degraded: bool
    rows: list[AdlQueueRow]


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
