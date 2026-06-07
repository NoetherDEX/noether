/**
 * Green-stack test trade: SUBMIT router.open_with_price → read position →
 * router.close_with_price, on-chain, timed. Exercises the Noeracle #30 fix.
 *
 *   cd scripts/keeper && STAGING_ADMIN_SECRET_KEY=S... npx ts-node src/test-trade.ts
 *
 * ⚠️ KNOWN LIMITATION — does NOT fully run from a plain script today.
 * `open_position` requires the trader to sign Soroban AUTH ENTRIES for the inner
 * USDC SAC `transfer(from=trader)` (and `trader.require_auth()`). A raw
 * simulateTransaction without recorded auth entries traps as
 * `Error(WasmVm, InvalidAction): UnreachableCodeReached`. Verified this is an
 * auth/harness limitation, NOT a contract bug: the LIVE production market traps
 * identically under the same simulation. A real wallet (Freighter) signs those
 * auth entries automatically, so the authoritative end-to-end test is a browser
 * trade on staging.noether.exchange — not this script. To make this script work
 * standalone it would need to build + sign SorobanAuthorizationEntry objects for
 * the trader (and the router→market→USDC sub-invocation tree).
 *
 * What IS proven on-chain without auth: the green keeper pushes signed prices to
 * Noeracle, and the green market reads them via shim→get_price_pers (e.g.
 * `is_liquidatable` returns cleanly) — i.e. the oracle path itself is sound.
 */
import {
  rpc, Contract, TransactionBuilder, Address, nativeToScVal, xdr, Keypair, scValToNative,
} from '@stellar/stellar-sdk';

const RPC = 'https://soroban-testnet.stellar.org';
const PASS = 'Test SDF Network ; September 2015';
const ADMIN = 'GCW7CENKM65B2MVMVJOQCFBZDGZ7FEK2WAKXCHLUUQKIAYKFYWC6KEVO';
const ROUTER = 'CCVPJ7O5AT4Z43RUOIFT4SYLTHKOHKFO6AND63XD7PKCLWTM6KDDJORP';
const MARKET = 'CB72GHQR236GJZBUYBTQI7WEMJBHJ245XOIOHVDE5L774JC6KJGOZYIR';

const SECRET = process.env.STAGING_ADMIN_SECRET_KEY!;
if (!SECRET) { console.error('set STAGING_ADMIN_SECRET_KEY'); process.exit(1); }
const kp = Keypair.fromSecret(SECRET);
const server = new rpc.Server(RPC);
const LONG = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Long')]);

async function freshBTC(): Promise<any> {
  const res = await fetch('https://api.noeracle.org/v1/latest');
  const body = (await res.json()) as { assets: Record<string, any> };
  return body.assets['BTC/USD'];
}
async function send(label: string, cid: string, method: string, args: xdr.ScVal[]) {
  const acct = await server.getAccount(ADMIN);
  const tx = new TransactionBuilder(acct, { fee: '3000000', networkPassphrase: PASS })
    .addOperation(new Contract(cid).call(method, ...args)).setTimeout(60).build();
  const sim: any = await server.simulateTransaction(tx);
  if (sim.error) throw new Error(`${label} sim failed: ${sim.error}`);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(kp);
  const t0 = Date.now();
  const sent = await server.sendTransaction(prepared);
  let r = await server.getTransaction(sent.hash);
  while (r.status === 'NOT_FOUND') { await new Promise(s => setTimeout(s, 500)); r = await server.getTransaction(sent.hash); }
  const ms = Date.now() - t0;
  if (r.status !== 'SUCCESS') throw new Error(`${label} FAILED on-chain: ${r.status}`);
  console.log(`  ✅ ${label}  (${ms}ms, tx ${sent.hash.slice(0,10)}…)`);
  return (r as any).returnValue ? scValToNative((r as any).returnValue) : null;
}
async function read(method: string, args: xdr.ScVal[]) {
  const acct = await server.getAccount(ADMIN);
  const tx = new TransactionBuilder(acct, { fee: '100', networkPassphrase: PASS })
    .addOperation(new Contract(MARKET).call(method, ...args)).setTimeout(30).build();
  const sim: any = await server.simulateTransaction(tx);
  return sim.result?.retval ? scValToNative(sim.result.retval) : null;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('  GREEN STACK TEST TRADE  (Noeracle router, 100 USDC @ 2x Long BTC)');
  console.log('═'.repeat(60));

  // ── freshness measurement (answers: is Noeracle fast enough?) ──
  const b0 = await freshBTC();
  const nowS = Math.floor(Date.now() / 1000);
  console.log(`\n[freshness] attestation age at fetch: ${nowS - b0.timestamp}s  (BTC $${b0.price_human}, round ${b0.round_id})`);

  console.log('\n[before] positions:', await read('get_all_position_ids', []));

  // ── TEST 1: open via router (atomic verify-then-trade) ──
  console.log('\n[TEST 1] router.open_with_price …');
  const b = await freshBTC();
  const openArgs = [
    new Address(ADMIN).toScVal(), nativeToScVal('BTC', { type: 'symbol' }),
    nativeToScVal(1000000000n, { type: 'i128' }), nativeToScVal(2, { type: 'u32' }), LONG,
    nativeToScVal(BigInt(b.price), { type: 'i128' }), nativeToScVal(BigInt(b.timestamp), { type: 'u64' }),
    nativeToScVal(BigInt(b.round_id), { type: 'u64' }),
    xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.from(b.publisher, 'hex'))]),
    xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.from(b.signature, 'hex'))]),
  ];
  const pos: any = await send('open_with_price', ROUTER, 'open_with_price', openArgs);
  console.log(`     → position id=${pos.id} entry=$${Number(pos.entry_price)/1e7} size=$${Number(pos.size)/1e7} collateral=$${Number(pos.collateral)/1e7}`);

  // ── read position back ──
  const ids = await read('get_all_position_ids', []);
  console.log('\n[after open] positions:', ids);

  // ── TEST 3: close via router ──
  console.log('\n[TEST 3] router.close_with_price …');
  const c = await freshBTC();
  const closeArgs = [
    new Address(ADMIN).toScVal(), nativeToScVal(BigInt(pos.id), { type: 'u64' }),
    nativeToScVal('BTC', { type: 'symbol' }),
    nativeToScVal(BigInt(c.price), { type: 'i128' }), nativeToScVal(BigInt(c.timestamp), { type: 'u64' }),
    nativeToScVal(BigInt(c.round_id), { type: 'u64' }),
    xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.from(c.publisher, 'hex'))]),
    xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.from(c.signature, 'hex'))]),
  ];
  const pnl: any = await send('close_with_price', ROUTER, 'close_with_price', closeArgs);
  console.log(`     → realized PnL = $${Number(pnl)/1e7}`);

  console.log('\n[after close] positions:', await read('get_all_position_ids', []));
  console.log('\n' + '═'.repeat(60));
  console.log('  ✅ ALL TESTS PASSED — no #30, router open+close on Noeracle price');
  console.log('═'.repeat(60));
}
main().catch((e) => { console.error('\n❌', e?.message || e); process.exit(1); });
