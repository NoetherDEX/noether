/**
 * End-to-end round-trip harness (TASKS.md P4-24, audit-readiness).
 *
 * Drives one scripted trade through the SAME path a real client uses —
 * gateway auth → /v1/orders/prepare (tx-builders → router/market) → local
 * sign → /v1/tx/submit → market → vault → indexer projection → API
 * read-back — and asserts the position appears and then disappears. This is
 * the integration test the Audit Bank checklist asks for; it also catches
 * cross-stack drift (e.g. the D-4 baked-address bug) that unit tests can't.
 *
 * It talks ONLY to the gateway + RPC (no direct contract imports), so it
 * exercises the deployed surface. Requires a live stack; configure via env
 * and run `npm run e2e`. With config missing it skips cleanly (exit 0) so it
 * can sit in CI without a stack.
 *
 * Required env:
 *   E2E_API_URL        gateway base, e.g. https://api.noether.exchange
 *   E2E_TRADER_SECRET  S... secret of a funded, USDC-holding, allowlisted trader
 *   E2E_NETWORK        'testnet' | 'mainnet'   (default testnet)
 * Optional:
 *   E2E_ASSET (BTC) · E2E_COLLATERAL (10) · E2E_LEVERAGE (2) · E2E_TIMEOUT_MS (60000)
 */

import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  BASE_FEE,
  Account,
} from '@stellar/stellar-sdk';

interface Env {
  apiUrl: string;
  traderSecret: string;
  network: 'testnet' | 'mainnet';
  asset: string;
  collateral: string; // whole USDC
  leverage: number;
  timeoutMs: number;
}

function loadEnv(): Env | null {
  const apiUrl = process.env.E2E_API_URL;
  const traderSecret = process.env.E2E_TRADER_SECRET;
  if (!apiUrl || !traderSecret) return null;
  return {
    apiUrl: apiUrl.replace(/\/$/, ''),
    traderSecret,
    network: (process.env.E2E_NETWORK as 'testnet' | 'mainnet') ?? 'testnet',
    asset: process.env.E2E_ASSET ?? 'BTC',
    collateral: process.env.E2E_COLLATERAL ?? '10',
    leverage: Number(process.env.E2E_LEVERAGE ?? 2),
    timeoutMs: Number(process.env.E2E_TIMEOUT_MS ?? 60_000),
  };
}

const PRECISION = 10_000_000n;
const passphrase = (net: Env['network']) => (net === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET);

function fail(msg: string): never {
  console.error(`\n❌ E2E FAILED: ${msg}`);
  process.exit(1);
}

async function api<T>(env: Env, path: string, init?: RequestInit & { bearer?: string }): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (init?.bearer) headers.authorization = `Bearer ${init.bearer}`;
  const res = await fetch(`${env.apiUrl}${path}`, { ...init, headers: { ...headers, ...(init?.headers as object) } });
  const text = await res.text();
  if (!res.ok) fail(`${init?.method ?? 'GET'} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Wallet-challenge auth: get a challenge, sign it as a manageData tx, exchange for a bearer key. */
async function authenticate(env: Env, kp: Keypair): Promise<string> {
  const address = kp.publicKey();
  const { challengeHex } = await api<{ challengeHex: string }>(env, '/v1/keys/challenge', {
    method: 'POST',
    body: JSON.stringify({ address }),
  });

  // Build a sequence-0 tx with a manageData op carrying the challenge; the
  // gateway verifies the signature against tx.hash() (the walletAuth path).
  const source = new Account(address, '0');
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: passphrase(env.network) })
    .addOperation(Operation.manageData({ name: 'noether-auth', value: Buffer.from(challengeHex, 'hex') }))
    .setTimeout(300)
    .build();
  tx.sign(kp);

  const { key } = await api<{ key: string }>(env, '/v1/keys', {
    method: 'POST',
    body: JSON.stringify({ address, challenge: challengeHex, signature: tx.toXDR() }),
  });
  return key;
}

/** Prepare → sign → submit one trading op; returns the submit result. */
async function prepareSignSubmit(
  env: Env,
  kp: Keypair,
  bearer: string,
  body: Record<string, unknown>,
): Promise<{ status: string; hash?: string }> {
  const prepared = await api<{ xdr: string }>(env, '/v1/orders/prepare', {
    method: 'POST',
    bearer,
    body: JSON.stringify(body),
  });
  const tx = TransactionBuilder.fromXDR(prepared.xdr, passphrase(env.network));
  tx.sign(kp);
  return api(env, '/v1/tx/submit', {
    method: 'POST',
    bearer,
    body: JSON.stringify({ xdr: tx.toXDR() }),
  });
}

interface OpenPositionRow { positionId: number; asset: string; }

async function pollPositions(env: Env, trader: string): Promise<OpenPositionRow[]> {
  const { positions } = await api<{ positions: OpenPositionRow[] }>(
    env,
    `/v1/positions/open?trader=${encodeURIComponent(trader)}`,
  );
  return positions;
}

async function waitFor<T>(label: string, ms: number, fn: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const got = await fn();
    if (got !== null) return got;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return fail(`timed out waiting for ${label} (${ms}ms)`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env) {
    console.log('⏭  E2E skipped — set E2E_API_URL and E2E_TRADER_SECRET to run the round-trip.');
    process.exit(0);
  }

  const kp = Keypair.fromSecret(env.traderSecret);
  const trader = kp.publicKey();
  console.log(`▶ E2E round-trip on ${env.network} · trader ${trader.slice(0, 6)}… · ${env.asset} ${env.collateral} USDC @ ${env.leverage}x`);

  // 0. Gateway is up + serving the expected stack (D-4 self-check).
  const health = await api<{ status: string; contracts?: Record<string, { address: string }> }>(env, '/v1/health');
  if (health.status !== 'ok') fail(`gateway unhealthy: ${JSON.stringify(health)}`);
  console.log(`✓ gateway healthy; market ${health.contracts?.market?.address?.slice(0, 6) ?? '?'}…`);

  // 1. Authenticate.
  const bearer = await authenticate(env, kp);
  console.log('✓ authenticated (bearer key issued)');

  const before = await pollPositions(env, trader);
  const beforeIds = new Set(before.map((p) => p.positionId));

  // 2. Open a position.
  const openRes = await prepareSignSubmit(env, kp, bearer, {
    op: 'open_position',
    asset: env.asset,
    collateral: (BigInt(env.collateral) * PRECISION).toString(),
    leverage: env.leverage,
    direction: 'Long',
  });
  if (openRes.status !== 'SUCCESS' && openRes.status !== 'PENDING') {
    fail(`open submit status ${openRes.status}`);
  }
  console.log(`✓ open submitted (${openRes.status}${openRes.hash ? ' ' + openRes.hash.slice(0, 8) : ''})`);

  // 3. Read-back: the indexer projection must surface the new position.
  const fresh = await waitFor('position to be indexed', env.timeoutMs, async () => {
    const rows = await pollPositions(env, trader);
    const nu = rows.find((p) => !beforeIds.has(p.positionId) && p.asset === env.asset);
    return nu ?? null;
  });
  console.log(`✓ position ${fresh.positionId} indexed + returned by /v1/positions/open`);

  // 4. Close it.
  const closeRes = await prepareSignSubmit(env, kp, bearer, {
    op: 'close_position',
    positionId: fresh.positionId,
  });
  if (closeRes.status !== 'SUCCESS' && closeRes.status !== 'PENDING') {
    fail(`close submit status ${closeRes.status}`);
  }
  console.log(`✓ close submitted (${closeRes.status})`);

  // 5. Read-back: the position must disappear from the projection.
  await waitFor('position to clear', env.timeoutMs, async () => {
    const rows = await pollPositions(env, trader);
    return rows.some((p) => p.positionId === fresh.positionId) ? null : true;
  });
  console.log(`✓ position ${fresh.positionId} cleared from the projection after close`);

  console.log('\n✅ E2E round-trip PASSED — gateway → market → vault → indexer → API all consistent.');
  process.exit(0);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
