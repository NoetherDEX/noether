/**
 * noether-sdk — WebSocket ticker example.
 *
 * Subscribes to ticker.BTC and prints every price update for 60 seconds.
 *
 *   # Node 22+ (native WebSocket)
 *   npx tsx sdk-ts/examples/ws-ticker.ts http://127.0.0.1:4000
 *
 *   # Older Node, pass the `ws` package:
 *   npx tsx sdk-ts/examples/ws-ticker.ts http://127.0.0.1:4000
 */

import { NoetherClient } from '../src/index.js';

async function main() {
  const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4000';
  const client = new NoetherClient({ baseUrl });
  const ws = client.ws({ onLog: (level, msg) => console.log(`[ws:${level}] ${msg}`) });

  await ws.connect();
  console.log('connected; subscribing to ticker.BTC');

  await ws.subscribe('ticker.BTC', (data, channel) => {
    const t = data as { asset: string; priceFloat: number; timestamp: number };
    console.log(`[${channel}] ${t.asset} = ${t.priceFloat} (oracle ts ${t.timestamp})`);
  });

  setTimeout(() => {
    console.log('done; closing');
    ws.close();
    process.exit(0);
  }, 60_000);
}

main().catch((err) => {
  console.error('ws example failed:', err);
  process.exit(1);
});
