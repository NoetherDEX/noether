import { NextRequest, NextResponse } from 'next/server';
import { Contract, Horizon, scValToNative, xdr, StrKey, rpc, TransactionBuilder, BASE_FEE, nativeToScVal } from '@stellar/stellar-sdk';
import { CONTRACTS, NETWORK } from '@/lib/utils/constants';
import { getDb, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KNOWN_SEEDS = [
  'GD46SNIBOAO3BPIFXRODPEOGUCHRSU2PGLEADIL2LAWTSFA6COL5BAKR',
  'GALMWIHNW2V56I4WBNFTPEXTHQPRYTJSHCFMO57XBFERG3WEOUB5XAIM',
];

const CALLER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const sorobanRpc = new rpc.Server(NETWORK.RPC_URL);
const marketContract = new Contract(CONTRACTS.MARKET);

// A tx whose events we still can't fetch after this long is treated as beyond
// the Soroban RPC retention window (or otherwise unrecoverable) and marked
// processed so the scan can converge. Recent txs (the common "my trade didn't
// count" case) stay below this and keep getting retried every run until they
// fetch successfully. ~6h ≫ any transient RPC hiccup, ≪ RPC retention.
const RETRY_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface TradeEvent {
  type: string;
  trader: string;
  size: number;
  pnl: number;
  positionId: string;
}

// Discriminates "definitively fetched (maybe zero relevant events)" from
// "couldn't fetch — retry later". Marking a tx processed on the latter is the
// data-loss bug this whole module exists to avoid.
type FetchResult = { ok: true; events: TradeEvent[] } | { ok: false };

function bigIntToNumber(value: bigint | number | undefined, decimals = 7): number {
  if (value === undefined || value === null) return 0;
  const num = typeof value === 'bigint' ? Number(value) : value;
  if (isNaN(num)) return 0;
  return num / Math.pow(10, decimals);
}

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
            // Reuse the single `account` fetched above — simulation ignores the
            // sequence number, so there is no need for a getAccount per id (that
            // doubled this loop's RPC load and starved the event fetches below).
            const posTx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.PASSPHRASE })
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
    console.error('[Cron] Error getting open positions:', error);
    return { traders: [], positions: [] };
  }
}

function parseMarketEvents(diagnosticEventsXdr: string[] | undefined): TradeEvent[] {
  if (!diagnosticEventsXdr?.length) return [];
  const events: TradeEvent[] = [];
  for (const eventXdrStr of diagnosticEventsXdr) {
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

      const positionId = String(data[0]);
      const trader = String(data[1]);
      let size = 0;
      let pnl = 0;
      if (topicName === 'position_opened') {
        // Event: (id, trader, asset, direction, size, entry_price)
        size = bigIntToNumber(data[4] as bigint);
      } else if (topicName === 'position_closed') {
        // Event: (id, trader, asset, direction, size, entry_price, current_price, pnl)
        size = bigIntToNumber(data[4] as bigint);
        pnl = bigIntToNumber(data[7] as bigint);
      } else if (topicName === 'position_liquidated') {
        // Event: (id, trader, asset, direction, size, keeper_reward, current_price)
        size = bigIntToNumber(data[4] as bigint);
      }
      events.push({ type: topicName, trader, size, pnl, positionId });
    } catch { /* skip a single malformed event, keep the rest */ }
  }
  return events;
}

// Fetch a tx's market events. Returns { ok: true } only when the RPC gave a
// DEFINITIVE answer (SUCCESS → parsed events; FAILED → the tx reverted, no
// trade) — both safe to mark processed. Returns { ok: false } on a transient
// failure (network error, or NOT_FOUND because the tx isn't ingested yet),
// which the caller must NOT mark processed, so it is retried next run. Retries
// a few times in-run to ride out the rate-limited public RPC.
async function getTransactionEvents(txHash: string): Promise<FetchResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(NETWORK.RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: { hash: txHash } }),
      });
      if (res.ok) {
        const json = await res.json();
        const status = json?.result?.status;
        if (status === 'SUCCESS') {
          return { ok: true, events: parseMarketEvents(json.result.diagnosticEventsXdr) };
        }
        if (status === 'FAILED') {
          // Reverted on-chain — no position change ever happened. Definitive.
          return { ok: true, events: [] };
        }
        // NOT_FOUND / missing result: not yet ingested or beyond retention.
        // Treat as transient here; the caller's age guard stops infinite retry.
      }
    } catch { /* network error — fall through to retry */ }
    await sleep(250 * (attempt + 1));
  }
  return { ok: false };
}

// Optional comma-separated wallets to force into the scan, set via Vercel env.
// Use it to recover a specific reported wallet (e.g. one that closed out before
// it was ever recorded) without a redeploy: set it, let one cron run scan +
// backfill them, then clear it. They become sticky via known_traders.
function parseEnvSeeds(): string[] {
  return (process.env.LEADERBOARD_SEED_ADDRESSES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function loadKnownTraders(): Promise<string[]> {
  const db = getDb();
  const res = await db.execute('SELECT address FROM known_traders');
  return res.rows.map((r) => r.address as string);
}

async function rememberTraders(addresses: Set<string>): Promise<void> {
  if (addresses.size === 0) return;
  const db = getDb();
  const list = Array.from(addresses);
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100);
    await db.batch(
      batch.map((address) => ({
        sql: 'INSERT OR IGNORE INTO known_traders (address) VALUES (?)',
        args: [address],
      }))
    );
  }
}

async function loadProcessedTxs(): Promise<Set<string>> {
  const db = getDb();
  const row = await db.execute({
    sql: 'SELECT value FROM sync_state WHERE key = ?',
    args: ['processed_txs'],
  });
  if (row.rows.length === 0) return new Set();
  return new Set(JSON.parse(row.rows[0].value as string) as string[]);
}

async function saveProcessedTxs(txs: Set<string>): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: 'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    args: ['processed_txs', JSON.stringify(Array.from(txs))],
  });
}

async function recomputeTraderAggregates(): Promise<void> {
  const db = getDb();
  await db.batch([
    'DELETE FROM traders',
    `INSERT INTO traders (address, trade_count, total_volume, total_pnl, last_updated)
     SELECT
       trader,
       SUM(CASE WHEN event_type = 'position_opened' THEN 1 ELSE 0 END),
       SUM(CASE WHEN event_type = 'position_opened' THEN size ELSE 0 END),
       SUM(CASE WHEN event_type != 'position_opened' THEN pnl ELSE 0 END),
       unixepoch()
     FROM trades
     GROUP BY trader`,
  ]);
}

export async function GET(request: NextRequest) {
  // Verify cron secret. Fail closed when unset — otherwise the comparison below
  // would accept a literal `Bearer undefined` from anyone (P0-14).
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureSchema();

    const alreadyProcessed = await loadProcessedTxs();
    const initialSize = alreadyProcessed.size;

    // Get existing trader addresses from DB
    const db = getDb();
    const existingTraders = await db.execute('SELECT address FROM traders');
    const knownAddresses = new Set(existingTraders.rows.map(r => r.address as string));

    // Get current open positions
    const { traders: openTraders, positions } = await getOpenPositionTraders();

    // Every trader we have ever seen, so closed-out wallets stay scannable, plus
    // any one-off recovery wallets injected via env.
    const persistedKnown = await loadKnownTraders();
    const envSeeds = parseEnvSeeds();

    // Collect all known trader addresses for BFS
    const allKnownTraders = new Set([
      ...KNOWN_SEEDS,
      ...envSeeds,
      ...openTraders,
      ...persistedKnown,
      ...Array.from(knownAddresses),
    ]);

    const horizon = new Horizon.Server(NETWORK.HORIZON_URL);
    const queue = Array.from(allKnownTraders);
    const scannedTraders = new Set<string>();
    // Traders to persist into known_traders this run (anyone with a real
    // position or event), so they are re-scanned even after closing out.
    const tradersToRemember = new Set<string>(openTraders);
    let newEventsCount = 0;
    let unrecoverableCount = 0;

    // Collect all new trade events for batch insert
    const newTradeRows: { txHash: string; trader: string; eventType: string; size: number; pnl: number }[] = [];

    while (queue.length > 0) {
      const trader = queue.shift()!;
      if (scannedTraders.has(trader)) continue;
      scannedTraders.add(trader);

      try {
        let page = await horizon.operations().forAccount(trader).order('desc').limit(200).call();
        let pageNum = 0;

        while (page.records.length > 0 && pageNum < 50) {
          pageNum++;
          // Collect unprocessed invoke-host-function txs on this page, keeping
          // each tx's age so we can bound retries for ones beyond RPC retention.
          const newTxs: { hash: string; createdAt: number }[] = [];
          const seenThisPage = new Set<string>();
          let foundInvokeOps = false;
          let hasNewTx = false;

          for (const op of page.records) {
            const rec = op as unknown as { type: string; transaction_hash: string; created_at?: string };
            if (rec.type !== 'invoke_host_function') continue;
            foundInvokeOps = true;
            if (!rec.transaction_hash) continue;
            if (alreadyProcessed.has(rec.transaction_hash)) continue;
            hasNewTx = true;
            if (seenThisPage.has(rec.transaction_hash)) continue;
            seenThisPage.add(rec.transaction_hash);
            const createdAt = rec.created_at ? Date.parse(rec.created_at) : Date.now();
            newTxs.push({ hash: rec.transaction_hash, createdAt });
          }

          // Fetch + record events. CRITICAL: only mark a tx processed once its
          // events were DEFINITIVELY fetched. On a transient failure, leave it
          // unprocessed so the next run retries — that no-retry-on-failure path
          // is what silently dropped traders' closed PnL. Old, persistently
          // unfetchable txs (beyond RPC retention) are given up on so the scan
          // still converges and the early-break below keeps working.
          for (let i = 0; i < newTxs.length; i += 20) {
            const batch = newTxs.slice(i, i + 20);
            const results = await Promise.all(batch.map((t) => getTransactionEvents(t.hash)));
            for (let j = 0; j < results.length; j++) {
              const { hash, createdAt } = batch[j];
              const result = results[j];
              if (result.ok) {
                alreadyProcessed.add(hash);
                for (const event of result.events) {
                  newEventsCount++;
                  newTradeRows.push({
                    // Composite key so multiple position_closed in one tx (cross
                    // closes) don't collide on UNIQUE(tx_hash, event_type, trader).
                    txHash: `${hash}#${event.positionId}`,
                    trader: event.trader,
                    eventType: event.type,
                    size: event.size,
                    pnl: event.pnl,
                  });

                  // Remember this trader so they stay scannable after closing out.
                  tradersToRemember.add(event.trader);

                  // Discover new traders for BFS
                  if (!scannedTraders.has(event.trader) && !queue.includes(event.trader)) {
                    queue.push(event.trader);
                  }
                }
              } else if (Date.now() - createdAt > RETRY_MAX_AGE_MS) {
                // Give up on an old, unfetchable tx so we stop re-scanning it.
                alreadyProcessed.add(hash);
                unrecoverableCount++;
              }
              // else: transient failure on a recent tx — leave unprocessed, retry next run.
            }
          }

          if (foundInvokeOps && !hasNewTx) break;
          try { page = await page.next(); } catch { break; }
        }
      } catch { /* skip trader */ }
    }

    // Ensure traders with open positions but no events get a row
    for (const pos of positions) {
      const hasExisting = await db.execute({
        sql: 'SELECT 1 FROM trades WHERE trader = ? LIMIT 1',
        args: [pos.trader],
      });
      if (hasExisting.rows.length === 0 && !newTradeRows.some(r => r.trader === pos.trader)) {
        newTradeRows.push({
          txHash: `open_position_${pos.trader}`,
          trader: pos.trader,
          eventType: 'position_opened',
          size: pos.size,
          pnl: 0,
        });
      }
    }

    // Batch insert new trades
    if (newTradeRows.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < newTradeRows.length; i += BATCH_SIZE) {
        const batch = newTradeRows.slice(i, i + BATCH_SIZE);
        await db.batch(
          batch.map(row => ({
            sql: 'INSERT OR IGNORE INTO trades (tx_hash, trader, event_type, size, pnl) VALUES (?, ?, ?, ?, ?)',
            args: [row.txHash, row.trader, row.eventType, row.size, row.pnl],
          }))
        );
      }
    }

    // Recompute aggregates, persist the seen-trader set + processed tx hashes
    await recomputeTraderAggregates();
    await rememberTraders(tradersToRemember);
    await saveProcessedTxs(alreadyProcessed);

    const newTxCount = alreadyProcessed.size - initialSize;
    console.log(`[Cron] Sync complete: ${newEventsCount} new events, ${newTxCount} new txs, ${scannedTraders.size} traders scanned, ${unrecoverableCount} unrecoverable (gave up after ${RETRY_MAX_AGE_MS / 3600000}h)`);

    return NextResponse.json({
      ok: true,
      newEvents: newEventsCount,
      newTxs: newTxCount,
      tradersScanned: scannedTraders.size,
      unrecoverable: unrecoverableCount,
    });
  } catch (error) {
    console.error('[Cron] Sync error:', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
