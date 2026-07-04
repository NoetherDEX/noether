/**
 * On-chain verification helper for the positions projection.
 *
 * liquidate_cross_account deletes every cross-margin position for the
 * trader on-chain but emits a single cross_liq event with no position
 * ids, and position_opened events carry no margin mode — so the only
 * reliable way to drop the dead rows is to re-check each of the
 * trader's projected positions via a `get_position` simulation and
 * delete the ones that come back None. Isolated positions still open
 * on-chain come back Some and are kept.
 */

import {
  Account,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import type { Client } from '@libsql/client';
import type { Logger } from 'pino';

// Any well-formed Stellar pubkey works as the simulation source — same
// convention as vaultSync.ts; override via INDEXER_VIEW_SOURCE.
const DEFAULT_VIEW_SOURCE = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';

export type OnChainPositionLookup =
  | { ok: true; position: Record<string, unknown> | null }
  | { ok: false };

export async function fetchOnChainPosition(
  rpcServer: rpc.Server,
  marketAddress: string,
  positionId: number,
  networkPassphrase: string,
  sourcePubkey: string = process.env.INDEXER_VIEW_SOURCE || DEFAULT_VIEW_SOURCE,
): Promise<OnChainPositionLookup> {
  const account = await rpcServer.getAccount(sourcePubkey).catch(() => null);
  if (!account) return { ok: false };
  const contract = new Contract(marketAddress);
  const tx = new TransactionBuilder(
    new Account(account.accountId(), account.sequenceNumber()),
    { fee: BASE_FEE, networkPassphrase },
  )
    .addOperation(contract.call('get_position', nativeToScVal(positionId, { type: 'u64' })))
    .setTimeout(30)
    .build();
  const sim = await rpcServer.simulateTransaction(tx).catch(() => null);
  if (!sim || !rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) return { ok: false };
  const raw = scValToNative(sim.result.retval) as Record<string, unknown> | null;
  return { ok: true, position: raw ?? null };
}

export async function cleanupCrossLiquidatedPositions(
  db: Client,
  rpcServer: rpc.Server,
  marketAddress: string,
  trader: string,
  networkPassphrase: string,
  log: Logger,
): Promise<void> {
  const result = await db.execute({
    sql: 'SELECT position_id FROM positions WHERE trader = ?',
    args: [trader],
  });
  for (const row of result.rows) {
    const positionId = Number((row as unknown as { position_id: number | bigint }).position_id);
    const lookup = await fetchOnChainPosition(rpcServer, marketAddress, positionId, networkPassphrase);
    if (!lookup.ok) {
      log.warn({ positionId, trader }, 'cross_liq on-chain position verify failed — row kept');
      continue;
    }
    if (lookup.position !== null) continue;
    await db.execute({
      sql: 'DELETE FROM positions WHERE position_id = ?',
      args: [positionId],
    });
    log.info({ positionId, trader }, 'cross_liq removed dead position row');
  }
}
