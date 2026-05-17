# noether-sdk

Official Python SDK for [Noether](https://noether.exchange) — a decentralized perpetual exchange on Stellar / Soroban.

Async-first (`httpx` + `pydantic`), typed, mirrors the public surface of [@noether/sdk](https://github.com/NoetherDEX/noether/tree/main/sdk-ts).

## Install

```bash
pip install noether-sdk
# Optional, only if you want to sign with a Stellar Keypair locally:
pip install "noether-sdk[stellar]"
```

## Quick start — public reads

```python
import asyncio
from noether_sdk import NoetherClient

async def main():
    async with NoetherClient("https://api.noether.exchange") as client:
        markets = await client.markets.list()
        btc = await client.oracle.get_price("BTC")
        print("BTC oracle:", btc.price_float)

asyncio.run(main())
```

## Authed: account info

```python
from noether_sdk.transport import Credentials

async with NoetherClient(
    "https://api.noether.exchange",
    credentials=Credentials("nk_...", "..."),
) as client:
    me = await client.account.me()
    positions = await client.account.positions()
```

## Issue an API key (one-shot)

```python
from stellar_sdk import Keypair

kp = Keypair.from_secret(os.environ["STELLAR_SECRET"])
async with NoetherClient("https://api.noether.exchange") as client:
    issued = await client.keys.create(
        address=kp.public_key,
        signer=lambda data: kp.sign(data),
        label="mm-bot-1",
    )
    print(issued.key_id, issued.secret)  # store immediately
```

## Place an order — `execute_trade`

```python
from stellar_sdk import Network, TransactionBuilder

def sign_xdr(xdr: str) -> str:
    tx = TransactionBuilder.from_xdr(xdr, Network.TESTNET_NETWORK_PASSPHRASE)
    tx.sign(kp)
    return tx.to_xdr()

prepared, submitted = await authed.execute_trade(
    {
        "op": "open_position",
        "asset": "XLM",
        "collateral": 1_000 * 10_000_000,
        "leverage": 2,
        "direction": "Long",
    },
    sign_xdr,
)
print(submitted.hash, submitted.status)
```

`execute_trade` calls `orders.prepare` → asks your `signer` for the signed XDR → calls `tx.submit` and polls until `SUCCESS` / `FAILED` / timeout.

## Sub-client cheatsheet

| Call | Auth |
|---|---|
| `client.health.ping()` | no |
| `client.markets.list()` / `get(asset)` | no |
| `client.oracle.get_price(asset)` / `get_prices()` | no |
| `client.events.list(topic=, ...)` | no |
| `client.keys.create({...})` | no |
| `client.keys.list()` / `revoke(id)` | yes |
| `client.account.me()` / `events()` / `positions()` / `orders()` | yes |
| `client.orders.prepare({op: ..., ...})` | yes |
| `client.tx.submit(signed_xdr=...)` | yes |
| `client.execute_trade({...}, signer)` | yes |
| `client.vaults.list()` / `get(id)` / `deposits/withdraws/fee_claims(id)` | no |
| `client.referral.lookup_code(code)` | no |
| `client.referral.me()` / `trades()` / `claims()` | yes |

## WebSocket

```python
from noether_sdk.ws import WsClient

ws = WsClient("wss://api.noether.exchange/v1/ws")
await ws.connect()
await ws.subscribe("ticker.BTC", lambda data, ch: print(ch, data["priceFloat"]))
```

`WsClient` reconnects automatically with exponential backoff and replays your active subscriptions on every reconnect.

## Errors

```python
from noether_sdk import (
    AuthError, RateLimitError, BadRequestError, ServerError,
)

try:
    await client.markets.get("DOGE")
except BadRequestError as err:
    print("bad request:", err.body)
except RateLimitError as err:
    print("retry in", err.retry_after_sec)
```

## Examples

- [`examples/place_order.py`](./examples/place_order.py) — Friendbot fund + key issuance + open_position end-to-end.
- [`examples/ws_ticker.py`](./examples/ws_ticker.py) — minimal WebSocket subscription.

## Dev

```bash
pip install -e ".[dev,stellar]"
pytest
```

## Status

Phase 7 v0 — REST surface complete + WS sub-client + 11 unit tests. Mirror of the TypeScript SDK shape so cross-language services can be written in either language without translation cost.
