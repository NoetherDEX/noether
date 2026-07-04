"""End-to-end Python SDK example.

1. Generate a fresh Stellar keypair and fund it via Friendbot.
2. Issue an API key by signing the gateway's challenge.
3. Prepare an open_position transaction.
4. Sign the prepared XDR with the keypair.
5. Submit and wait for confirmation.

NOTE: Friendbot only provides XLM. The open_position step needs testnet
USDC collateral — fund the wallet at https://testnet.noether.exchange/faucet
before step 3, or it will fail.

Run:
    pip install 'noether-sdk[stellar]'
    python sdk-py/examples/place_order.py http://127.0.0.1:4000
"""

import asyncio
import sys

import httpx
from stellar_sdk import Keypair, Network, TransactionBuilder

from noether_sdk import NoetherClient
from noether_sdk.transport import Credentials


async def main() -> None:
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4000"

    kp = Keypair.random()
    address = kp.public_key
    print(f"generated keypair: {address}")

    print("funding via friendbot...")
    async with httpx.AsyncClient() as http:
        r = await http.get(f"https://friendbot.stellar.org/?addr={address}")
        if r.is_error:
            raise RuntimeError(f"friendbot failed ({r.status_code}): {r.text}")

    await asyncio.sleep(4)  # let soroban-rpc see the new account

    async with NoetherClient(base_url) as client:
        issued = await client.keys.create(
            address=address,
            signer=lambda data: kp.sign(data),
            label="py-sdk-example",
        )
        print(f"issued key: {issued.key_id}")

        authed = client.with_credentials(Credentials(issued.key_id, issued.secret))
        async with authed:
            me = await authed.account.me()
            print("me:", me)

            def sign_xdr(xdr: str) -> str:
                tx = TransactionBuilder.from_xdr(
                    xdr, Network.TESTNET_NETWORK_PASSPHRASE
                )
                tx.sign(kp)
                return tx.to_xdr()

            prepared, submitted = await authed.execute_trade(
                {
                    "op": "open_position",
                    "asset": "XLM",
                    "collateral": 1_000 * 10_000_000,  # 1000 USDC
                    "leverage": 2,
                    "direction": "Long",
                },
                sign_xdr,
            )
            print("prepared:", {"trader": prepared.trader, "op": prepared.op})
            print("submitted:", submitted)


if __name__ == "__main__":
    asyncio.run(main())
