/**
 * noether-sdk — demo script.
 *
 * Shows the public + authed surface against a running gateway using an
 * existing API key (env vars NK + NS). No keypair generation, no
 * Friendbot, no USDC trustline setup — purely demonstrates that every
 * sub-client is reachable and returning live data.
 *
 * Run:
 *   export NK="nk_..."
 *   export NS="..."
 *   npx tsx sdk-ts/examples/demo.ts http://localhost:4000
 */

import { NoetherClient } from '../src/index.js';

const C = {
  dim:   (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan:  (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold:  (s: string) => `\x1b[1m${s}\x1b[0m`,
};

function step(n: number, title: string): void {
  console.log('');
  console.log(C.amber(`▶ ${n}. ${title}`));
}

async function main() {
  const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4000';
  const keyId = process.env.NK;
  const secret = process.env.NS;

  if (!keyId || !secret) {
    console.error('Missing $NK / $NS env vars — export them first.');
    process.exit(1);
  }

  console.log(C.bold('Noether SDK demo'));
  console.log(C.dim(`base: ${baseUrl}  ·  key: ${keyId}`));

  const client = new NoetherClient({ baseUrl }).withCredentials({ keyId, secret });

  // ─── 1 ───────────────────────────────────────────────────────────
  step(1, 'Health check (public)');
  const health = await client.health.ping();
  console.log(C.green('✓'), `status=${health.status}  uptime=${Math.floor(health.uptime)}s`);

  // ─── 2 ───────────────────────────────────────────────────────────
  step(2, 'Markets (public)');
  const markets = await client.markets.list();
  for (const m of markets) {
    console.log(
      `  ${C.cyan(m.asset.symbol.padEnd(4))}  oracle=$${m.oracle.priceFloat.toFixed(4)}`,
    );
  }

  // ─── 3 ───────────────────────────────────────────────────────────
  step(3, 'Oracle prices (public)');
  const prices = await client.oracle.getPrices();
  for (const p of prices) {
    console.log(`  ${C.cyan(p.asset.padEnd(4))}  $${p.priceFloat.toFixed(4)}  ${C.dim(`ts=${p.timestamp}`)}`);
  }

  // ─── 4 ───────────────────────────────────────────────────────────
  step(4, 'Who am I? (authenticated)');
  const me = await client.account.me();
  console.log(`  address  ${C.cyan(me.owner)}`);
  console.log(`  tier     ${me.tier}`);
  console.log(`  keyId    ${me.keyId}`);

  // ─── 5 ───────────────────────────────────────────────────────────
  step(5, 'My positions + orders');
  const [positions, orders] = await Promise.all([
    client.account.positions(),
    client.account.orders(),
  ]);
  console.log(`  open positions  ${positions.length}`);
  console.log(`  open orders     ${orders.length}`);

  // ─── 6 ───────────────────────────────────────────────────────────
  step(6, 'Vault marketplace');
  const vaults = await client.vaults.list();
  for (const v of vaults) {
    console.log(
      `  #${String(v.id).padStart(2)}  ${C.cyan(v.name.padEnd(10))}  ` +
        `leader=${v.leader.slice(0, 8)}…  totalUsdc=${v.totalUsdc}`,
    );
  }

  // ─── 7 ───────────────────────────────────────────────────────────
  step(7, 'Recent on-chain events');
  const events = await client.events.list({ limit: 5 });
  for (const e of events) {
    console.log(`  ${C.cyan(e.topic.padEnd(18))}  ledger=${e.ledger}`);
  }

  // ─── 8 ───────────────────────────────────────────────────────────
  step(8, 'Prepare a trade — 10 USDC × 2x BTC long');
  const prepared = await client.orders.prepare({
    op: 'open_position',
    asset: 'BTC',
    collateral: 100_000_000n,
    leverage: 2,
    direction: 'Long',
  });
  console.log(`  trader  ${prepared.trader.slice(0, 8)}…${prepared.trader.slice(-4)}`);
  console.log(`  op      ${prepared.op}`);
  console.log(`  xdr     ${prepared.xdr.slice(0, 60)}…`);
  console.log(C.dim('  (XDR returned; user signs locally and POSTs to /v1/tx/submit)'));

  console.log('');
  console.log(C.green(C.bold('✓ All sub-clients reachable.')));
}

main().catch((err) => {
  console.error('\ndemo failed:', err);
  process.exit(1);
});
