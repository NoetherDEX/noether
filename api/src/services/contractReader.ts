/**
 * Read-only Soroban contract caller.
 *
 * Wraps `simulateTransaction` for view-method calls. The simulation runs
 * against any source account that exists on the network — no signing or
 * funds are required because the call never gets submitted. The source
 * account public key is configurable via API_SOURCE_ACCOUNT (defaults to
 * the admin pubkey from contracts.json).
 *
 * Account sequence numbers are cached briefly so we don't hit RPC for
 * every read.
 */

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { getNetworkPassphrase } from '@noether/shared';
import type { Network, StellarAddress } from '@noether/types';

const ACCOUNT_TTL_MS = 30_000;
/** getLedgerEntries accepts up to 200 keys; keep requests small on the public RPC. */
const LEDGER_KEY_CHUNK = 50;

export interface ContractReaderOptions {
  rpcUrl: string;
  network: Network;
  sourceAccount: StellarAddress;
}

interface CachedAccount {
  account: Account;
  fetchedAt: number;
}

export class ContractReader {
  private readonly server: rpc.Server;
  private readonly networkPassphrase: string;
  private readonly sourceAccount: StellarAddress;
  private cachedSource: CachedAccount | null = null;

  constructor(opts: ContractReaderOptions) {
    this.server = new rpc.Server(opts.rpcUrl, { allowHttp: opts.rpcUrl.startsWith('http://') });
    this.networkPassphrase = getNetworkPassphrase(opts.network);
    this.sourceAccount = opts.sourceAccount;
  }

  /**
   * Read the market's live open counters straight from ledger storage
   * (Phase 4 drift alarm). The counters are plain persistent entries with
   * unit DataKeys — scvVec([scvSymbol(name)]) — so no view function and no
   * simulation is involved. Null per counter when the key does not exist,
   * which is exactly the pre-upgrade market: the caller renders null rather
   * than a fabricated zero.
   */
  async readOpenCounts(
    marketId: StellarAddress,
  ): Promise<{ chainOpenPositions: number | null; chainOpenOrders: number | null }> {
    const contract = Address.fromString(marketId).toScAddress();
    const keyFor = (name: string) =>
      xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract,
          key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]),
          durability: xdr.ContractDataDurability.persistent(),
        }),
      );
    const positionKey = keyFor('OpenPositionCount');
    const orderKey = keyFor('OpenOrderCount');
    const response = await this.server.getLedgerEntries(positionKey, orderKey);

    let chainOpenPositions: number | null = null;
    let chainOpenOrders: number | null = null;
    for (const entry of response.entries ?? []) {
      const data = entry.val.contractData();
      const keyXdr = data.key().toXDR('base64');
      const value = Number(scValToNative(data.val()));
      if (keyXdr === positionKey.contractData().key().toXDR('base64')) {
        chainOpenPositions = value;
      } else if (keyXdr === orderKey.contractData().key().toXDR('base64')) {
        chainOpenOrders = value;
      }
    }
    return { chainOpenPositions, chainOpenOrders };
  }

  /**
   * Read the market's per-asset open-interest aggregates straight from
   * ledger storage (L1-13 capacity headroom). `AssetExposure(Symbol)` is a
   * persistent entry holding `(long_k, long_size, short_k, short_size)`;
   * its key is scvVec([scvSymbol('AssetExposure'), scvSymbol(asset)]). One
   * batched getLedgerEntries per call. An absent entry is an asset nobody
   * has traded yet — that IS zero exposure, so it decodes to zeros rather
   * than null. Sizes are 7-decimal USDC notional, the exact values the
   * market hands to vault.reserve_for_position.
   */
  async readAssetExposure(
    marketId: StellarAddress,
    symbols: readonly string[],
  ): Promise<{ exposure: Map<string, { long: bigint; short: bigint }>; latestLedger: number | null }> {
    const contract = Address.fromString(marketId).toScAddress();
    const keys = symbols.map((symbol) =>
      xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract,
          key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('AssetExposure'), xdr.ScVal.scvSymbol(symbol)]),
          durability: xdr.ContractDataDurability.persistent(),
        }),
      ),
    );
    const bySymbol = new Map<string, string>();
    keys.forEach((k, i) => bySymbol.set(k.contractData().key().toXDR('base64'), symbols[i]!));

    const exposure = new Map<string, { long: bigint; short: bigint }>();
    for (const symbol of symbols) exposure.set(symbol, { long: 0n, short: 0n });
    let latestLedger: number | null = null;
    for (let i = 0; i < keys.length; i += LEDGER_KEY_CHUNK) {
      const response = await this.server.getLedgerEntries(...keys.slice(i, i + LEDGER_KEY_CHUNK));
      if (typeof response.latestLedger === 'number') latestLedger = response.latestLedger;
      for (const entry of response.entries ?? []) {
        const data = entry.val.contractData();
        const symbol = bySymbol.get(data.key().toXDR('base64'));
        if (!symbol) continue;
        const tuple = scValToNative(data.val()) as unknown[];
        if (!Array.isArray(tuple) || tuple.length < 4) continue;
        exposure.set(symbol, { long: BigInt(tuple[1] as bigint), short: BigInt(tuple[3] as bigint) });
      }
    }
    return { exposure, latestLedger };
  }

  /**
   * Invoke a view function on a contract and return the decoded native value.
   * Throws on simulation error.
   */
  async read<T = unknown>(
    contractId: StellarAddress,
    method: string,
    args: xdr.ScVal[] = [],
  ): Promise<T> {
    const account = await this.getSourceAccount();
    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`Contract read failed: ${contractId}.${method}: ${sim.error}`);
    }
    if (!sim.result) {
      throw new Error(`Contract read returned no result: ${contractId}.${method}`);
    }
    return scValToNative(sim.result.retval) as T;
  }

  private async getSourceAccount(): Promise<Account> {
    const now = Date.now();
    if (this.cachedSource && now - this.cachedSource.fetchedAt < ACCOUNT_TTL_MS) {
      // Bump local sequence to avoid replays inside the cache window.
      const acct = this.cachedSource.account;
      acct.incrementSequenceNumber();
      return acct;
    }
    const remote = await this.server.getAccount(this.sourceAccount);
    const account = new Account(remote.accountId(), remote.sequenceNumber());
    this.cachedSource = { account, fetchedAt: now };
    return account;
  }
}
