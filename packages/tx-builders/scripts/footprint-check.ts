/**
 * Footprint inspector — the deterministic on-chain check for the stale-footprint
 * hardening (2026-08-30 incident: a close simulated with an empty insurance
 * buffer declared vault `BufferBalance` read-only, the buffer refilled before
 * apply, the write trapped the tx).
 *
 * Builds a router `close_with_price` for a live position exactly like the web
 * / SDK do, WITHOUT sending anything, and classifies the vault + market keys of
 * interest in the simulated footprint:
 *
 *   --raw   : plain simulation (no client padding) — proves the CONTRACT side.
 *             Pre-fix vault: `TotalFees` is absent and `ShortfallReserve`
 *             read-only on a winning close; post-fix both are read-write.
 *   (default): with the client footprint guard — proves the CLIENT side:
 *             every conditional key is read-write regardless of state.
 *
 * Expectations:
 *   pre  : the 2026-08-30 pre-fix shape (raw)
 *   post : the 2026-08-30 fix — vault buckets read-write (raw)
 *   full : the 2026-09-02 completion — EVERY watched key read-write on a raw
 *          simulation, whichever sign the position's PnL has right now
 *          (shortfall books via settle_pnl / receive_loss_for, AdlActive
 *          created on touch). This is the runbook gate after an upgrade.
 *
 * Usage (from the repo root):
 *   npx tsx packages/tx-builders/scripts/footprint-check.ts staging <positionId> <traderG> <ASSET> [--raw] [--expect pre|post|full]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Transaction, TransactionBuilder, Networks, xdr, StrKey } from '@stellar/stellar-sdk';
import { Router, type TxBuildContext } from '../src/index.js';

const [, , env, positionIdArg, trader, asset, ...flags] = process.argv;
if (!env || !positionIdArg || !trader || !asset) {
  console.error('usage: footprint-check.ts <staging|prod> <positionId> <traderG> <ASSET> [--raw] [--expect pre|post|full]');
  process.exit(2);
}
const raw = flags.includes('--raw');
const expectIdx = flags.indexOf('--expect');
const expect = expectIdx >= 0 ? flags[expectIdx + 1] : undefined;

const manifestPath = resolve(process.cwd(), env === 'prod' ? 'contracts.json' : 'contracts.staging.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { contracts: Record<string, string> };
const { market, vault, noetherRouter } = manifest.contracts;

interface LatestEntry { price: string; timestamp: number; round_id: number; publisher: string; signature: string }
async function fetchAttestation(sym: string) {
  const res = await fetch('https://api.noeracle.org/v1/latest');
  const body = (await res.json()) as { assets?: Record<string, LatestEntry> };
  const e = body.assets?.[`${sym}/USD`];
  if (!e) throw new Error(`no attestation for ${sym}`);
  return { asset: sym, prices: [BigInt(e.price)], pubkeys: [e.publisher], roundId: e.round_id, sigs: [e.signature], timestamp: e.timestamp };
}

const NAMES: Record<string, string> = { [market]: 'market', [vault]: 'vault' };
function keyLabel(k: xdr.LedgerKey): string | null {
  if (k.switch().name !== 'contractData') return null;
  const cd = k.contractData();
  let contract = '?';
  try { contract = StrKey.encodeContract(cd.contract().contractId()); } catch { /* not a contract address */ }
  const name = NAMES[contract];
  if (!name) return null;
  const vec = cd.key().vec();
  if (!vec || vec.length === 0) return `${name}:<instance>`;
  const variant = vec[0]!.switch().name === 'scvSymbol' ? vec[0]!.sym().toString() : vec[0]!.switch().name;
  return `${name}:${variant}`;
}

async function main() {
  const ctx: TxBuildContext = {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    network: 'testnet',
    ...(raw ? {} : { contracts: { market, vault } }),
  };
  const attestation = await fetchAttestation(asset);
  const prepared = await Router.buildCloseWithPriceTx(ctx, noetherRouter, {
    trader,
    positionId: BigInt(positionIdArg),
    acceptablePrice: 0n,
    attestation,
  });
  const tx = TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET) as Transaction;
  const sd = tx.toEnvelope().v1().tx().ext().sorobanData()!;
  const fp = sd.resources().footprint();
  const cls = new Map<string, string>();
  for (const k of fp.readOnly()) { const l = keyLabel(k); if (l) cls.set(l, 'RO'); }
  for (const k of fp.readWrite()) { const l = keyLabel(k); if (l) cls.set(l, 'RW'); }

  const watch = ['vault:BufferBalance', 'vault:TotalUsdc', 'vault:TotalFees', 'vault:ShortfallReserve', 'vault:Shortfall', 'vault:CumShortfall', 'vault:ShortfallOwed', 'market:AdlActive', 'market:LastGoodPrice'];
  console.log(`${env} close_with_price position ${positionIdArg} (${asset}) — ${raw ? 'RAW simulation (contract side)' : 'WITH client footprint guard'}`);
  console.log(`declared: instructions=${sd.resources().instructions()} readBytes=${sd.resources().diskReadBytes()} writeBytes=${sd.resources().writeBytes()} resourceFee=${sd.resourceFee().toString()} total fee=${tx.fee}`);
  for (const w of watch) console.log(`  ${w.padEnd(26)} ${cls.get(w) ?? 'absent'}`);

  if (expect) {
    const rw = (k: string) => cls.get(k) === 'RW';
    let ok = true;
    if (raw && expect === 'pre') {
      // Old vault on a winning close: TotalFees never touched, reserve read-only.
      ok = !cls.has('vault:TotalFees') && cls.get('vault:ShortfallReserve') === 'RO';
    } else if (raw && expect === 'post') {
      ok = rw('vault:BufferBalance') && rw('vault:TotalUsdc') && rw('vault:TotalFees') && rw('vault:ShortfallReserve');
    } else if (raw && expect === 'full') {
      // Contract side alone must declare the whole set — no client padding.
      ok = watch.every((w) => rw(w));
    } else {
      ok = watch.every((w) => rw(w));
    }
    console.log(ok ? `EXPECTATION MET (${raw ? 'raw' : 'guarded'}, ${expect})` : `EXPECTATION FAILED (${raw ? 'raw' : 'guarded'}, ${expect})`);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => { console.error('footprint-check failed:', e instanceof Error ? e.message : e); process.exit(1); });
