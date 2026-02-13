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

interface TradeEvent {
  type: string;
  trader: string;
  size: number;
  pnl: number;
}

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
    console.error('[Cron] Error getting open positions:', error);
    return { traders: [], positions: [] };
  }
}

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
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    // Collect all known trader addresses for BFS
    const allKnownTraders = new Set([
      ...KNOWN_SEEDS,
      ...openTraders,
      ...Array.from(knownAddresses),
    ]);

    const horizon = new Horizon.Server(NETWORK.HORIZON_URL);
    const queue = Array.from(allKnownTraders);
    const scannedTraders = new Set<string>();
    let newEventsCount = 0;

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
            for (let j = 0; j < results.length; j++) {
              for (const event of results[j]) {
                newEventsCount++;
                newTradeRows.push({
                  txHash: batch[j],
                  trader: event.trader,
                  eventType: event.type,
                  size: event.size,
                  pnl: event.pnl,
                });

                // Discover new traders for BFS
                if (!scannedTraders.has(event.trader) && !queue.includes(event.trader)) {
                  queue.push(event.trader);
                }
              }
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

    // Recompute aggregates and save processed tx hashes
    await recomputeTraderAggregates();
    await saveProcessedTxs(alreadyProcessed);

    const newTxCount = alreadyProcessed.size - initialSize;
    console.log(`[Cron] Sync complete: ${newEventsCount} new events, ${newTxCount} new txs, ${scannedTraders.size} traders scanned`);

    return NextResponse.json({
      ok: true,
      newEvents: newEventsCount,
      newTxs: newTxCount,
      tradersScanned: scannedTraders.size,
    });
  } catch (error) {
    console.error('[Cron] Sync error:', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
