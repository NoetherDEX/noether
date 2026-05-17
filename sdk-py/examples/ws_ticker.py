"""Subscribe to ticker.BTC and print 60 seconds of price updates.

Run:
    pip install noether-sdk
    python sdk-py/examples/ws_ticker.py http://127.0.0.1:4000
"""

import asyncio
import sys

from noether_sdk.ws import WsClient


async def main() -> None:
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4000"
    ws_url = base_url.replace("http", "ws").rstrip("/") + "/v1/ws"

    ws = WsClient(ws_url)
    await ws.connect()
    print(f"connected to {ws_url}")

    def on_tick(data: object, channel: str) -> None:
        if isinstance(data, dict):
            print(f"[{channel}] {data.get('asset')} = {data.get('priceFloat')}")

    await ws.subscribe("ticker.BTC", on_tick)
    await asyncio.sleep(60)
    await ws.close()


if __name__ == "__main__":
    asyncio.run(main())
