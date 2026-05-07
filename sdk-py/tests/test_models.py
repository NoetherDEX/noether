from noether_sdk.models import (
    HealthStatus,
    MarketSummary,
    OracleSnapshot,
    ReferralMeResponse,
    ReferrerRow,
    VaultRow,
)


def test_health_round_trip() -> None:
    h = HealthStatus.model_validate({"status": "ok", "uptime": 1.5, "version": "0.0.0"})
    assert h.status == "ok"
    assert h.uptime == 1.5


def test_oracle_snapshot_camel_to_snake() -> None:
    snap = OracleSnapshot.model_validate(
        {"asset": "BTC", "price": "600000000000", "price_float": 60000.0, "timestamp": 1}
    )
    assert snap.asset == "BTC"
    assert snap.price == "600000000000"
    assert snap.price_float == 60000.0


def test_market_summary_nested() -> None:
    m = MarketSummary.model_validate(
        {
            "asset": {"symbol": "BTC", "name": "Bitcoin", "decimals": 8},
            "oracle": {"asset": "BTC", "price": "0", "price_float": 0.0, "timestamp": 0},
        }
    )
    assert m.asset.symbol == "BTC"
    assert m.oracle.timestamp == 0


def test_vault_row_keeps_string_precision() -> None:
    v = VaultRow.model_validate(
        {
            "id": 0,
            "leader": "G",
            "name": "alpha",
            "created_at": 1,
            "total_usdc": "12345678901234567",
            "circulating_shares": "0",
            "hwm_nav": "10000000",
            "realized_pnl": "0",
            "leader_shares": "0",
            "profit_share_bps": 1000,
            "paused": False,
            "updated_at": 2,
        }
    )
    assert v.total_usdc == "12345678901234567"
    assert v.profit_share_bps == 1000


def test_referral_me_with_self_field() -> None:
    me = ReferralMeResponse(
        self_=ReferrerRow.model_validate(
            {
                "referrer": "G",
                "code": "alice",
                "created_at": 1,
                "referred_count": 5,
                "total_volume_generated": "1000",
                "total_earned": "100",
                "claimable": "100",
                "updated_at": 2,
            }
        ),
        binding=None,
    )
    assert me.self_ is not None
    assert me.self_.code == "alice"
    assert me.binding is None
