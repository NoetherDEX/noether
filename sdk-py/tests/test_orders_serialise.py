from noether_sdk.sub.orders import serialise_request


def test_open_position_serialises_bigint_collateral() -> None:
    body = serialise_request(
        {
            "op": "open_position",
            "asset": "BTC",
            "collateral": 1_000_000_000,
            "leverage": 5,
            "direction": "Long",
        }
    )
    assert body["collateral"] == "1000000000"
    assert body["op"] == "open_position"


def test_place_limit_renames_to_camel() -> None:
    body = serialise_request(
        {
            "op": "place_limit_order",
            "asset": "ETH",
            "direction": "Short",
            "collateral": 500,
            "leverage": 3,
            "trigger_price": 30_000_000_000,
            "trigger_condition": "Below",
            "slippage_tolerance_bps": 100,
        }
    )
    assert body["triggerPrice"] == "30000000000"
    assert body["triggerCondition"] == "Below"
    assert body["slippageToleranceBps"] == 100


def test_cancel_order_stringifies_id() -> None:
    body = serialise_request({"op": "cancel_order", "order_id": 42})
    assert body["orderId"] == "42"
