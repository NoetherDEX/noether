/**
 * Phantom open-position cleanup for cross-margin liquidations (I-5 / P0-17).
 *
 * `cross_liq` closes ALL of a trader's cross-margin positions, but the event
 * carries no position ids — so the open-position projection would keep showing
 * them as open (phantoms). We reconcile by reading the live on-chain open-id set
 * (`get_all_position_ids`) and deleting the trader's projection rows that are no
 * longer open, which leaves any still-open isolated positions untouched.
 */

import {
  Account,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import type { Client } from '@libsql/client';
import type { Logger } from 'pino';

// Any funded pubkey works as the simulation source (read-only, fees never
// charged). Defaults to the Noether testnet admin; override with INDEXER_VIEW_SOURCE.
const DEFAULT_VIEW_SOURCE = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';

/** Open position ids currently live on-chain, or null if the read failed. */
async function fetchOpenPositionIds(
  rpcServer: rpc.Server,
  marketAddress: string,
  networkPassphrase: string,
  source: string = process.env.INDEXER_VIEW_SOURCE || DEFAULT_VIEW_SOURCE,
): Promise<Set<number> | null> {
  const account = await rpcServer.getAccount(source).catch(() => null);
  if (!account) return null;
  const contract = new Contract(marketAddress);
  const tx = new TransactionBuilder(
    new Account(account.accountId(), account.sequenceNumber()),
    { fee: BASE_FEE, networkPassphrase },
  )
    .addOperation(contract.call('get_all_position_ids'))
    .setTimeout(30)
    .build();
  const sim = await rpcServer.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) return null;
  const ids = scValToNative(sim.result.retval) as Array<number | bigint> | null;
  if (!Array.isArray(ids)) return null;
  return new Set(ids.map((x) => Number(x)));
}

/**
 * Delete the trader's projection rows that are no longer open on-chain.
 * Best-effort: an RPC failure logs and leaves the projection untouched rather
 * than throwing (a throw would dead-letter the whole cross_liq event).
 */
export async function reconcileCrossPositions(
  db: Client,
  rpcServer: rpc.Server,
  marketAddress: string,
  networkPassphrase: string,
  trader: string,
  log: Logger,
): Promise<void> {
  const onChain = await fetchOpenPositionIds(rpcServer, marketAddress, networkPassphrase).catch(() => null);
  if (!onChain) {
    log.warn({ trader }, 'cross_liq: skipped phantom cleanup — could not read on-chain position ids');
    return;
  }
  const rows = await db.execute({
    sql: 'SELECT position_id FROM positions WHERE trader = ?',
    args: [trader],
  });
  const stale = rows.rows
    .map((r) => Number((r as unknown as { position_id: number | bigint }).position_id))
    .filter((id) => !onChain.has(id));
  for (const id of stale) {
    await db.execute({ sql: 'DELETE FROM positions WHERE position_id = ?', args: [id] });
  }
  if (stale.length > 0) {
    log.info({ trader, removed: stale.length }, 'cross_liq: removed phantom open positions');
  }
}
