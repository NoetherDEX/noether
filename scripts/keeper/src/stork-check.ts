/**
 * One-shot Stork key/endpoint validator.
 *
 * Run this the moment the STORK_API_KEY arrives: it makes one batched
 * fetch for every configured asset, prints what parsed, and cross-checks
 * each price against a fresh Noeracle attestation so you see the two
 * sources side by side before enabling anything on-chain.
 *
 *   cd scripts/keeper && STORK_API_KEY=<token> npm run stork:check
 *
 * Exit codes: 0 = key works and prices parsed; 1 = key missing, endpoint
 * unreachable, or nothing parseable (fix before relying on Stork).
 */

import { loadConfig } from './config';
import { getStorkPrice, getStorkStatus, refreshStorkPrices, storkEnabled } from './stork';

async function main(): Promise<void> {
  const config = loadConfig();

  if (!storkEnabled(config)) {
    throw new Error('STORK_API_KEY is not set — export it (or add to .env) and rerun');
  }

  const symbols = config.assets.map((a) => a.symbol);
  console.log(`Stork REST : ${config.storkRestUrl}`);
  console.log(`Assets     : ${symbols.join(', ')}`);
  console.log('');

  await refreshStorkPrices(config, symbols);
  const status = getStorkStatus(config);
  if (status.lastSuccessAt === null) {
    throw new Error(`Stork fetch failed: ${status.lastError ?? 'unknown error'}`);
  }

  // Side-by-side with Noeracle so divergence is visible immediately.
  let noeraclePrices = new Map<string, number>();
  try {
    const { Noeracle } = await import('@noeracle/sdk');
    const client = new Noeracle({ network: config.network });
    const fresh = await client.fetchLatest(symbols.map((s) => `${s}/USD`));
    noeraclePrices = new Map(
      fresh.attestations.map((a) => [a.asset.replace('/USD', ''), a.price_human]),
    );
  } catch (error) {
    console.warn(
      `⚠️  Noeracle fetch failed (${error instanceof Error ? error.message : error}) — showing Stork only`,
    );
  }

  let parsed = 0;
  console.log('symbol   stork            noeracle         divergence');
  for (const symbol of symbols) {
    const stork = getStorkPrice(symbol, config.storkMaxAgeMs);
    if (stork === null) {
      console.log(`${symbol.padEnd(8)} (no data — not in this key's entitlement?)`);
      continue;
    }
    parsed++;
    const noeracle = noeraclePrices.get(symbol);
    const divergence =
      noeracle !== undefined ? `${(((stork - noeracle) / noeracle) * 100).toFixed(3)}%` : '—';
    console.log(
      `${symbol.padEnd(8)} $${String(stork).padEnd(15)} $${String(noeracle ?? '—').padEnd(15)} ${divergence}`,
    );
  }

  if (parsed === 0) {
    throw new Error(
      'Key authenticated but no configured asset parsed — check the entitlement list with Stork',
    );
  }
  console.log('');
  console.log(`✅ Stork key OK — ${parsed}/${symbols.length} configured assets available`);
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
