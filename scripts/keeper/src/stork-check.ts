/**
 * One-shot Stork Fast validator (L0-8 relay_stork wiring).
 *
 * Connects to the Fast WS with the configured key, captures ONE signed
 * frame, prints the parsed prices side-by-side with a fresh Noeracle
 * round, then SIMULATES router.relay_stork with the captured payload —
 * proving the on-chain verifier accepts real production traffic before
 * anything is deployed or armed.
 *
 *   cd scripts/keeper && npm run stork:check
 *
 * Exit codes: 0 = frame captured, parsed, and the router simulation
 * accepted it; 1 = key missing, feed unreachable, or the router rejected.
 */

import { loadConfig } from './config';
import { storkEnabled } from './stork';
import { StorkFastClient, STORK_DEFAULT_ID_SYMBOLS, type FastFrame } from './storkFast';
import { StellarClient } from './stellar';

const FRAME_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const config = loadConfig();

  if (!storkEnabled(config)) {
    throw new Error('STORK_API_KEY is not set — add it to scripts/keeper/.env and rerun');
  }

  console.log(`Fast WS    : ${config.storkWsUrl}`);
  console.log(`Asset ids  : ${config.storkAssetIds.join(', ')}`);
  console.log('');

  const frame = await captureOneFrame(config.storkWsUrl, config.storkApiKey, config.storkAssetIds);
  const idToSymbol = new Map<number, string>(STORK_DEFAULT_ID_SYMBOLS);
  const ageMs = Date.now() - Number(frame.timestampNs / 1_000_000n);
  console.log(`✅ Frame captured: taxonomy ${frame.taxonomy}, ${frame.entries.size} assets, signed ${ageMs}ms ago, ${frame.payloadHex.length / 2} bytes`);
  console.log('');

  // Side-by-side with Noeracle so divergence is visible immediately.
  let noeraclePrices = new Map<string, number>();
  try {
    const { Noeracle } = await import('@noeracle/sdk');
    const client = new Noeracle({ network: config.network });
    const pairs = [...frame.entries.keys()]
      .map((id) => idToSymbol.get(id))
      .filter((s): s is string => !!s)
      .map((s) => `${s}/USD`);
    const fresh = await client.fetchLatest(pairs);
    noeraclePrices = new Map(
      fresh.attestations.map((a) => [a.asset.replace('/USD', ''), a.price_human]),
    );
  } catch (error) {
    console.warn(
      `⚠️  Noeracle fetch failed (${error instanceof Error ? error.message : error}) — showing Stork only`,
    );
  }

  console.log('symbol   stork            noeracle         divergence');
  for (const [id, stork] of frame.entries) {
    const symbol = idToSymbol.get(id) ?? `id${id}`;
    const noeracle = noeraclePrices.get(symbol);
    const divergence =
      noeracle !== undefined ? `${(((stork - noeracle) / noeracle) * 100).toFixed(3)}%` : '—';
    console.log(
      `${symbol.padEnd(8)} $${String(stork).padEnd(15)} $${String(noeracle ?? '—').padEnd(15)} ${divergence}`,
    );
  }
  console.log('');

  // The real proof: does the deployed router's verifier accept this payload?
  if (!config.routerContractId) {
    console.warn('⚠️  No router configured — skipping the relay_stork simulation');
    return;
  }
  const stellar = new StellarClient(config);
  const sim = await stellar.simulateRelayStork(Buffer.from(frame.payloadHex, 'hex'));
  if (!sim.ok) {
    throw new Error(`router.relay_stork simulation REJECTED the live payload: ${sim.error}`);
  }
  console.log(`✅ router.relay_stork simulation accepted the payload (router ${config.routerContractId.slice(0, 8)}…)`);
}

function captureOneFrame(wsUrl: string, apiKey: string, assetIds: number[]): Promise<FastFrame> {
  return new Promise((resolve, reject) => {
    const client = new StorkFastClient({
      wsUrl,
      apiKey,
      assetIds,
      onFrame: (frame) => {
        client.stop();
        clearTimeout(timer);
        resolve(frame);
      },
    });
    const timer = setTimeout(() => {
      const status = client.status();
      client.stop();
      reject(
        new Error(
          `no signed frame within ${FRAME_TIMEOUT_MS / 1000}s (connected: ${status.connected}, reconnects: ${status.reconnects}, last error: ${status.lastError ?? 'none'})`,
        ),
      );
    }, FRAME_TIMEOUT_MS);
    client.start();
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exit(1);
  });
