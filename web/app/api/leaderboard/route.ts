import { NextResponse } from 'next/server';
import { Contract, Horizon, scValToNative, xdr, StrKey, rpc, TransactionBuilder, BASE_FEE, nativeToScVal } from '@stellar/stellar-sdk';
import { CONTRACTS, NETWORK } from '@/lib/utils/constants';

// Force dynamic rendering (no static caching on Vercel)
export const dynamic = 'force-dynamic';
// Allow up to 60s for the scan (Vercel Pro), Hobby plan caps at 10s
export const maxDuration = 60;

interface LeaderboardTrader {
  address: string;
  tradeCount: number;
  totalVolume: number;
  pnl: number;
}

interface TradeEvent {
  type: string;
  trader: string;
  size: number;
  pnl: number;
}

interface PersistedData {
  processedTxs: string[];
  traders: Record<string, { tradeCount: number; totalVolume: number; pnl: number }>;
  lastUpdated: number;
}

// In-memory persistence across requests within the same serverless instance.
// On Vercel, module-level variables survive across warm invocations of the
// same function instance, so incremental data accumulates until a cold start.
let persistedStore: PersistedData = { processedTxs: [], traders: {}, lastUpdated: 0 };

// In-memory cache for fast responses
let memoryCached: LeaderboardTrader[] | null = null;
let memoryCacheTime = 0;
const MEMORY_CACHE_TTL = 60 * 1000; // 1 minute

const KNOWN_SEEDS = [
  'GD46SNIBOAO3BPIFXRODPEOGUCHRSU2PGLEADIL2LAWTSFA6COL5BAKR',
  'GALMWIHNW2V56I4WBNFTPEXTHQPRYTJSHCFMO57XBFERG3WEOUB5XAIM',
];

const CALLER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const sorobanRpc = new rpc.Server(NETWORK.RPC_URL);
const marketContract = new Contract(CONTRACTS.MARKET);

function bigIntToNumber(value: bigint | number | undefined, decimals = 7): number {
  if (value === undefined || value === null) return 0;
  const num = typeof value === 'bigint' ? Number(value) : value;
  if (isNaN(num)) return 0;
  return num / Math.pow(10, decimals);
}

function loadPersistedData(): PersistedData {
  return persistedStore;
}

function savePersistedData(data: PersistedData): void {
  persistedStore = data;
}

/** Get traders with open positions from the contract */
async function getOpenPositionTraders(): Promise<{ traders: string[]; positions: { trader: string; size: number }[] }> {
  try {
    const account = await sorobanRpc.getAccount(CALLER);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.PASSPHRASE })
      .addOperation(marketContract.call('get_all_position_ids'))
      .setTimeout(30)
      .build();

    const simResult = await sorobanRpc.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(simResult) || !simResult.result?.retval) return { traders: [], positions: [] };

    const ids = (scValToNative(simResult.result.retval) as (number | bigint)[]).map(Number);
    const traders = new Set<string>();
    const positions: { trader: string; size: number }[] = [];

    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const results = await Promise.all(
        batch.map(async (id) => {
          try {
            const acc = await sorobanRpc.getAccount(CALLER);
            const posTx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK.PASSPHRASE })
              .addOperation(marketContract.call('get_position', nativeToScVal(BigInt(id), { type: 'u64' })))
              .setTimeout(30)
              .build();
            const posResult = await sorobanRpc.simulateTransaction(posTx);
            if (rpc.Api.isSimulationSuccess(posResult) && posResult.result?.retval) {
              const pos = scValToNative(posResult.result.retval) as { trader: string; size: bigint };
              return { trader: pos.trader, size: bigIntToNumber(pos.size) };
            }
          } catch { /* skip */ }
          return null;
        })
      );
      for (const r of results) {
        if (r) {
          traders.add(r.trader);
          positions.push(r);
        }
      }
    }

    return { traders: Array.from(traders), positions };
  } catch (error) {
    console.error('[Leaderboard] Error getting open positions:', error);
    return { traders: [], positions: [] };
  }
}

/** Get trade events from a transaction via Soroban RPC */
async function getTransactionEvents(txHash: string): Promise<TradeEvent[]> {
  try {
    const res = await fetch(NETWORK.RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: { hash: txHash } }),
    });
    const json = await res.json();
    if (!json.result || json.result.status !== 'SUCCESS') return [];
    if (!json.result.diagnosticEventsXdr?.length) return [];

    const events: TradeEvent[] = [];
    for (const eventXdrStr of json.result.diagnosticEventsXdr) {
      try {
        const diagEvent = xdr.DiagnosticEvent.fromXDR(eventXdrStr, 'base64');
        const contractEvent = diagEvent.event();
        if (!contractEvent) continue;
        const contractBuf = contractEvent.contractId();
        if (!contractBuf) continue;
        if (StrKey.encodeContract(contractBuf as unknown as Buffer) !== CONTRACTS.MARKET) continue;

        const body = contractEvent.body().v0();
        const topics = body.topics();
        if (!topics.length) continue;
        const topicName = scValToNative(topics[0]) as string;
        if (!['position_opened', 'position_closed', 'position_liquidated'].includes(topicName)) continue;

        const data = scValToNative(body.data());
        if (!Array.isArray(data) || !data[1]) continue;

        const trader = String(data[1]);
        let size = 0;
        let pnl = 0;
        if (topicName === 'position_opened') {
          size = bigIntToNumber(data[3] as bigint);
        } else {
          size = bigIntToNumber(data[4] as bigint);
          pnl = bigIntToNumber(data[7] as bigint);
        }
        events.push({ type: topicName, trader, size, pnl });
      } catch { /* skip */ }
    }
    return events;
  } catch {
    return [];
  }
}

/**
 * Incremental BFS scan: scans trader operations via Horizon,
 * skips already-processed transactions, persists results to disk.
 */
async function incrementalScan(): Promise<LeaderboardTrader[]> {
  const persisted = loadPersistedData();
  const alreadyProcessed = new Set(persisted.processedTxs);
  const traderData = persisted.traders;

  // Get current open positions for seed traders
  const { traders: openTraders, positions } = await getOpenPositionTraders();

  // Collect all known trader addresses
  const allKnownTraders = new Set([
    ...KNOWN_SEEDS,
    ...openTraders,
    ...Object.keys(traderData),
  ]);

  const horizon = new Horizon.Server(NETWORK.HORIZON_URL);
  const queue = Array.from(allKnownTraders);
  const scannedTraders = new Set<string>();
  let newEventsCount = 0;

  while (queue.length > 0) {
    const trader = queue.shift()!;
    if (scannedTraders.has(trader)) continue;
    scannedTraders.add(trader);

    try {
      let page = await horizon.operations().forAccount(trader).order('desc').limit(200).call();
      let pageNum = 0;

      while (page.records.length > 0 && pageNum < 50) {
        pageNum++;
        const newTxHashes: string[] = [];
        let foundInvokeOps = false;
        let hasNewTx = false;

        for (const op of page.records) {
          const rec = op as unknown as { type: string; transaction_hash: string };
          if (rec.type !== 'invoke_host_function') continue;
          foundInvokeOps = true;
          if (!rec.transaction_hash) continue;
          if (alreadyProcessed.has(rec.transaction_hash)) continue;
          hasNewTx = true;
          alreadyProcessed.add(rec.transaction_hash);
          newTxHashes.push(rec.transaction_hash);
        }

        // Process new transactions in parallel batches
        for (let i = 0; i < newTxHashes.length; i += 20) {
          const batch = newTxHashes.slice(i, i + 20);
          const results = await Promise.all(batch.map((h) => getTransactionEvents(h)));
          for (const events of results) {
            for (const event of events) {
              newEventsCount++;
              const entry = traderData[event.trader] || { tradeCount: 0, totalVolume: 0, pnl: 0 };
              if (event.type === 'position_opened') {
                entry.tradeCount += 1;
                entry.totalVolume += event.size;
              } else {
                entry.pnl += event.pnl;
              }
              traderData[event.trader] = entry;

              // Discover new traders for BFS
              if (!scannedTraders.has(event.trader) && !queue.includes(event.trader)) {
                queue.push(event.trader);
              }
            }
          }
        }

        // If we found invoke ops but none were new, older pages won't have new ones either (desc order)
        if (foundInvokeOps && !hasNewTx) break;

        try { page = await page.next(); } catch { break; }
      }
    } catch { /* skip trader */ }
  }

  // Ensure traders with open positions but no events are included
  for (const pos of positions) {
    if (!traderData[pos.trader]) {
      traderData[pos.trader] = { tradeCount: 1, totalVolume: pos.size, pnl: 0 };
    }
  }

  // Persist to in-memory store (survives across warm invocations)
  const updatedData: PersistedData = {
    processedTxs: Array.from(alreadyProcessed),
    traders: traderData,
    lastUpdated: Date.now(),
  };
  savePersistedData(updatedData);

  console.log(`[Leaderboard] Incremental scan: ${newEventsCount} new events, ${Object.keys(traderData).length} total traders, ${scannedTraders.size} traders scanned, ${Array.from(alreadyProcessed).length - persisted.processedTxs.length} new txs found`);

  // Build leaderboard array
  const leaderboard: LeaderboardTrader[] = Object.entries(traderData).map(([address, data]) => ({
    address,
    ...data,
  }));
  leaderboard.sort((a, b) => b.totalVolume - a.totalVolume);
  return leaderboard;
}

export async function GET() {
  try {
    // Fast path: return from memory cache
    if (memoryCached && Date.now() - memoryCacheTime < MEMORY_CACHE_TTL) {
      return NextResponse.json(memoryCached, {
        headers: { 'Cache-Control': 'no-cache' },
      });
    }

    const data = await incrementalScan();

    memoryCached = data;
    memoryCacheTime = Date.now();

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-cache' },
    });
  } catch (error) {
    console.error('[Leaderboard] Error:', error);

    // If scan fails, try to return persisted data
    const persisted = loadPersistedData();
    if (Object.keys(persisted.traders).length > 0) {
      const fallback = Object.entries(persisted.traders)
        .map(([address, data]) => ({ address, ...data }))
        .sort((a, b) => b.totalVolume - a.totalVolume);
      return NextResponse.json(fallback);
    }

    return NextResponse.json([], { status: 500 });
  }
}
