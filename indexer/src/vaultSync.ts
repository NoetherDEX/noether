/**
 * On-chain re-sync helper for the vaults projection.
 *
 * The contract resyncs total_usdc from its live USDC SAC balance after
 * every leader proxy (open / close / claim), and the leader_close /
 * fees_claimed events don't carry the settled amount — so the only
 * reliable way to keep the projection truthful is to read the canonical
 * VaultInfo struct back out via the `view_vault` simulation. This
 * module wraps that call and writes the resulting row back to libsql.
 */

import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import type { Client } from '@libsql/client';
import type { Logger } from 'pino';

// Any well-formed Stellar pubkey works as the simulation source — we
// just need the network to find a valid account for fee accounting.
// This one belongs to the Noether testnet admin, which is guaranteed
// funded; production runs can override via INDEXER_VIEW_SOURCE.
const DEFAULT_VIEW_SOURCE = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';

export interface OnChainVaultRow {
  id: number;
  totalUsdc: bigint;
  circulatingShares: bigint;
  hwmNav: bigint;
  realizedPnl: bigint;
  leaderShares: bigint;
  paused: boolean;
}

export async function fetchOnChainVault(
  rpcServer: rpc.Server,
  vaultFactoryAddress: string,
  vaultId: number,
  networkPassphrase: string,
  sourcePubkey: string = process.env.INDEXER_VIEW_SOURCE || DEFAULT_VIEW_SOURCE,
): Promise<OnChainVaultRow | null> {
  const account = await rpcServer.getAccount(sourcePubkey).catch(() => null);
  if (!account) return null;
  const contract = new Contract(vaultFactoryAddress);
  const tx = new TransactionBuilder(
    new Account(account.accountId(), account.sequenceNumber()),
    { fee: BASE_FEE, networkPassphrase },
  )
    .addOperation(contract.call('view_vault', xdr.ScVal.scvU32(vaultId)))
    .setTimeout(30)
    .build();
  const sim = await rpcServer.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) return null;
  const raw = scValToNative(sim.result.retval) as Record<string, unknown> | null;
  if (!raw) return null;
  return {
    id: vaultId,
    totalUsdc: BigInt((raw.total_usdc as string | number | bigint | undefined) ?? 0),
    circulatingShares: BigInt((raw.circulating_shares as string | number | bigint | undefined) ?? 0),
    hwmNav: BigInt((raw.hwm_nav as string | number | bigint | undefined) ?? 0),
    realizedPnl: BigInt((raw.realized_pnl as string | number | bigint | undefined) ?? 0),
    leaderShares: BigInt((raw.leader_shares as string | number | bigint | undefined) ?? 0),
    paused: Boolean(raw.paused ?? false),
  };
}

export async function syncVaultRow(
  db: Client,
  rpcServer: rpc.Server,
  vaultFactoryAddress: string,
  vaultId: number,
  networkPassphrase: string,
): Promise<void> {
  const row = await fetchOnChainVault(rpcServer, vaultFactoryAddress, vaultId, networkPassphrase);
  if (!row) return;
  await db.execute({
    sql: `
      UPDATE vaults
      SET total_usdc         = ?,
          circulating_shares = ?,
          hwm_nav            = ?,
          realized_pnl       = ?,
          leader_shares      = ?,
          paused             = ?,
          updated_at         = ?
      WHERE id = ?
    `,
    args: [
      row.totalUsdc.toString(),
      row.circulatingShares.toString(),
      row.hwmNav.toString(),
      row.realizedPnl.toString(),
      row.leaderShares.toString(),
      row.paused ? 1 : 0,
      Date.now(),
      row.id,
    ],
  });
}

/**
 * Boot-time reconciliation: rewrite every vault row from the canonical
 * on-chain state. Catches the case where the projection drifted while
 * the indexer was running an older codepath (e.g. before leader_open
 * decrement, or before this on-chain sync existed).
 */
export async function reconcileAllVaults(
  db: Client,
  rpcServer: rpc.Server,
  vaultFactoryAddress: string,
  networkPassphrase: string,
  log: Logger,
): Promise<void> {
  const result = await db.execute('SELECT id FROM vaults ORDER BY id ASC');
  for (const row of result.rows) {
    const id = Number((row as unknown as { id: number | bigint }).id);
    try {
      await syncVaultRow(db, rpcServer, vaultFactoryAddress, id, networkPassphrase);
      log.info({ vaultId: id }, 'vault row reconciled from chain');
    } catch (err) {
      log.warn({ vaultId: id, err: (err as Error).message }, 'vault reconcile failed');
    }
  }
}

// Side-effect-only helper: ignore the unused Address import.
void Address;
