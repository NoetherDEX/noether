/**
 * Noether Keeper Bot - Stellar/Soroban Client
 *
 * Handles all blockchain interactions including:
 * - Oracle price updates
 * - Position queries and liquidations
 * - Order queries and executions
 *
 * Reliability posture (K-1/K-4/K-6):
 * - Every rpc.Server is constructed with a 15s HTTP timeout — a hung RPC
 *   request can no longer freeze the keeper loop.
 * - Multiple RPC endpoints (SOROBAN_RPC_URLS) are rotated on transient
 *   transport failures.
 * - Simulations use a constant dummy Account (sequence is irrelevant for
 *   simulateTransaction) instead of a getAccount round-trip per call.
 * - Read helpers THROW on transport/simulation failure — callers must not
 *   confuse "errored" with "empty" (K-4's silent-swallow bug).
 * - Liquidation submissions escalate the inclusion fee 2× per retry
 *   (capped), and a tx that is still NOT_FOUND after the polling window is
 *   surfaced as indeterminate instead of being blindly rebuilt.
 */

import {
  Keypair,
  Contract,
  rpc,
  TransactionBuilder,
  xdr,
  Address,
  scValToNative,
  nativeToScVal,
  Account,
  Operation,
  SorobanDataBuilder,
} from '@stellar/stellar-sdk';
import { KeeperConfig, Position, Order, ExecutionResult, SimulationOutcome } from './types';
// Type-only — the @noeracle/sdk package is ESM-only; the index.ts loader
// uses dynamic import, but we only need the Attestation shape here.
import type { Attestation } from '@noeracle/sdk';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
/** HTTP timeout for every RPC request (K-1). */
const RPC_TIMEOUT_MS = 15_000;
/**
 * Transaction timeBounds, aligned with the confirmation polling window
 * (K-6): we poll ~30s, so the tx expires right around when we stop
 * looking. NOT_FOUND after the window is treated as indeterminate.
 */
const TX_TIMEOUT_SECONDS = 30;
const CONFIRM_POLL_ATTEMPTS = 30;
const CONFIRM_POLL_DELAY_MS = 1000;
/** Base inclusion fee: 1 XLM (same flat value the keeper always used). */
const BASE_INCLUSION_FEE = 10_000_000;
/** Escalation cap for liquidations: 5 XLM inclusion fee (K-6). */
const MAX_INCLUSION_FEE = 50_000_000;
const READ_FEE = '100';

/**
 * Contract error codes that are business rejections, not transient faults —
 * never retried, never alert-spammed (see noether_common/src/errors.rs):
 * 20 PositionNotFound, 50 NotLiquidatable, 55 FundingIntervalNotElapsed,
 * 60 OrderNotFound, 61 OrderNotPending, 62 OrderNotTriggered,
 * 63 SlippageExceeded, 78 CrossMarginNotLiquidatable,
 * 80 CrossMarginOrderNotSupported, 81 PriceDeviationTooHigh,
 * 82 OpenInterestCapExceeded, 83 staged-liq grace,
 * 84 AdlNotActive, 85 AdlNotEligible (L0-1),
 * 86 LiquidationNotConfirmed (L0-9), 87 AcceptablePriceExceeded (L0-10),
 * 89 SkewCapExceeded (L0-14), 90 Frozen (L0-15), 91 NetsToZero (L1-3),
 * 92 AssetHalted (L1-24).
 */
const NON_RETRYABLE_CODES = new Set([
  20, 50, 55, 60, 61, 62, 63, 78, 80, 81, 82, 83, 84, 85, 86, 87, 89, 90, 91, 92,
]);

const NON_RETRYABLE_NAMES = [
  'SlippageExceeded',
  'OrderNotTriggered',
  'OrderNotFound',
  'OrderNotPending',
  'NotLiquidatable',
  'CrossMarginNotLiquidatable',
  'CrossMarginOrderNotSupported',
  'PriceDeviationTooHigh',
  'OpenInterestCapExceeded',
  'PositionNotFound',
  'FundingIntervalNotElapsed',
];

/** Extract the numeric contract error code from a HostError message, if any. */
export function extractContractErrorCode(message: string): number | null {
  const match = message.match(/Error\(Contract, #(\d+)\)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * True when a simulation/read failure means the ENTRY POINT does not exist
 * on the deployed contract (a pre-upgrade chain) rather than a transient
 * fault — the Wasm VM reports a missing export as MissingValue / "invoking
 * unknown export". Callers use this to disable phases that target entry
 * points newer than the deployed market (e.g. ADL before Batch-1).
 */
export function isMissingContractFunction(message: string): boolean {
  return /MissingValue|unknown export|invoking unknown/i.test(message);
}

function isNonRetryableContractError(message: string): boolean {
  const code = extractContractErrorCode(message);
  if (code !== null && NON_RETRYABLE_CODES.has(code)) return true;
  return NON_RETRYABLE_NAMES.some((name) => message.includes(name));
}

/**
 * Thrown when a submitted transaction was still NOT_FOUND after the whole
 * confirmation polling window. The tx MAY still land (timeBounds are only
 * checked at ledger close) — callers must re-check on-chain state before
 * rebuilding a duplicate (K-6).
 */
export class TxIndeterminateError extends Error {
  constructor(public readonly txHash: string) {
    super(`Transaction ${txHash} not confirmed within the polling window — outcome indeterminate`);
    this.name = 'TxIndeterminateError';
  }
}

function isTransientRpcError(error: unknown): boolean {
  // Node's fetch wraps network errors as `fetch failed` with the real
  // reason in `cause` (typed in ES2022 — accessed loosely for ES2020 lib).
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const message =
    error instanceof Error
      ? `${error.message} ${cause instanceof Error ? cause.message : ''}`
      : String(error);
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|aborted|timed? ?out|network|429|502|503|504/i.test(
    message,
  );
}

interface WriteOptions {
  /** Double the inclusion fee on each retry, capped (liquidations — K-6). */
  escalateFees?: boolean;
  /** Override the retry budget (default MAX_RETRIES). */
  maxRetries?: number;
  /**
   * Called when a submission came back indeterminate: return true if the
   * operation is still needed on-chain (→ safe to rebuild), false if the
   * target is gone (tx probably landed — do NOT resubmit a duplicate).
   */
  recheck?: () => Promise<boolean>;
}

export class StellarClient {
  private servers: rpc.Server[];
  private serverIndex = 0;
  private keypair: Keypair;
  private networkPassphrase: string;
  private marketContract: Contract;
  private noeracleContract: Contract;
  /** Vault contract — ADL coverage reads (L0-1). Null when unconfigured. */
  private vaultContract: Contract | null;
  /** Vault factory — order reconcile duty (L0-20). Null when unconfigured. */
  private factoryContract: Contract | null;

  constructor(private config: KeeperConfig) {
    this.servers = config.rpcUrls.map(
      (url) =>
        new rpc.Server(url, {
          timeout: RPC_TIMEOUT_MS,
          allowHttp: url.startsWith('http://'),
        }),
    );
    this.keypair = Keypair.fromSecret(config.secretKey);
    this.networkPassphrase = config.networkPassphrase;
    this.marketContract = new Contract(config.marketContractId);
    this.noeracleContract = new Contract(config.noeracleContractId);
    this.vaultContract = config.vaultContractId ? new Contract(config.vaultContractId) : null;
    this.factoryContract = config.vaultFactoryContractId
      ? new Contract(config.vaultFactoryContractId)
      : null;
  }

  get publicKey(): string {
    return this.keypair.publicKey();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RPC Failover (K-6)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Run an RPC operation against the current endpoint; on a TRANSIENT
   * transport failure rotate to the next endpoint and try again (each
   * endpoint at most once per call). Non-transient errors (simulation
   * errors, contract errors) propagate immediately.
   */
  private async withRpc<T>(operation: (server: rpc.Server) => Promise<T>): Promise<T> {
    let lastError: unknown;
    const count = this.servers.length;
    for (let attempt = 0; attempt < count; attempt++) {
      const index = this.serverIndex;
      try {
        return await operation(this.servers[index]);
      } catch (error) {
        lastError = error;
        if (!isTransientRpcError(error) || count === 1) throw error;
        this.serverIndex = (index + 1) % count;
        console.warn(
          `\n⚠️  RPC ${this.config.rpcUrls[index]} transient failure (${
            error instanceof Error ? error.message : error
          }) — rotating to ${this.config.rpcUrls[this.serverIndex]}`,
        );
      }
    }
    throw lastError;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Account Management
  // ═══════════════════════════════════════════════════════════════════════

  async getAccount(): Promise<Account> {
    return this.withRpc((server) => server.getAccount(this.keypair.publicKey()));
  }

  /**
   * Native XLM balance of the keeper wallet, in XLM (P3-10). An empty keeper
   * wallet freezes prices AND liquidations, so the caller alarms below a
   * threshold. Read via getLedgerEntries (RPC has no balance-bearing
   * getAccount). Returns null on read failure so the caller can distinguish
   * "low" from "couldn't check".
   */
  async getXlmBalance(): Promise<number | null> {
    try {
      const acctKey = xdr.LedgerKey.account(
        new xdr.LedgerKeyAccount({
          accountId: Keypair.fromPublicKey(this.keypair.publicKey()).xdrAccountId(),
        }),
      );
      const res = await this.withRpc((server) => server.getLedgerEntries(acctKey));
      const entry = res.entries?.[0];
      if (!entry) return null;
      const stroops = entry.val.account().balance().toBigInt();
      return Number(stroops) / 10_000_000;
    } catch {
      return null;
    }
  }

  /**
   * Extend a contract's instance+code TTL via the canonical
   * extendFootprintTtl operation (P3-9). An archived instance is a dead
   * exchange until restored, and the keeper doesn't otherwise write to
   * vault/router/shim. Best-effort: returns true on a PENDING submit, false
   * on any failure (logged by the caller, never fatal). On-chain verification
   * of the footprint is the operator's first-run step.
   */
  async bumpContractTtl(contractId: string, extendTo: number): Promise<boolean> {
    if (!contractId) return false;
    try {
      const account = await this.getAccount();
      const instanceKey = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: new Address(contractId).toScAddress(),
          key: xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: xdr.ContractDataDurability.persistent(),
        }),
      );
      const sorobanData = new SorobanDataBuilder().setReadOnly([instanceKey]).build();
      const tx = new TransactionBuilder(account, {
        fee: String(BASE_INCLUSION_FEE),
        networkPassphrase: this.networkPassphrase,
      })
        .setSorobanData(sorobanData)
        .addOperation(Operation.extendFootprintTtl({ extendTo }))
        .setTimeout(TX_TIMEOUT_SECONDS)
        .build();
      const prepared = await this.withRpc((server) => server.prepareTransaction(tx));
      prepared.sign(this.keypair);
      const res = await this.withRpc((server) => server.sendTransaction(prepared));
      return res.status === 'PENDING';
    } catch {
      return false;
    }
  }

  /**
   * Constant dummy source for simulations (K-4): simulateTransaction does
   * not validate sequence numbers, so a well-formed Account with sequence 0
   * avoids a getAccount round-trip per simulation. A fresh object per call
   * because TransactionBuilder mutates the sequence on build().
   */
  private simulationSource(): Account {
    return new Account(this.keypair.publicKey(), '0');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Oracle Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Publish a whole round of signed Noeracle attestations in ONE transaction
   * via the HARDENED `update_batch_ed25519_persistent` (S-1): Noeracle
   * enforces the registered-publisher gate, a 60s staleness bound, and
   * monotonic round_ids on-chain (a lagging round is a silent no-op).
   *
   * Every attestation in the batch MUST share (timestamp, round_id,
   * publisher): the contract verifies each per-asset signature over those
   * shared round fields with ONE publisher key. The attestation service
   * signs every pair per round, so a normal fetch is already one group —
   * the mixed-round guard here is a safety net, not a hot path.
   *
   * The attestation message is laid out as [tag(8) || price(16) || ts(8) || …],
   * so the first 8 bytes give us each BytesN<8> asset tag — Noeracle's
   * publisher already encoded the right tag into every signed message.
   */
  async updateNoeracleBatchPersistent(attestations: Attestation[]): Promise<ExecutionResult> {
    if (attestations.length === 0) {
      return { success: false, error: 'empty attestation batch' };
    }
    const first = attestations[0];
    const mixed = attestations.some(
      (a) =>
        a.timestamp !== first.timestamp ||
        a.round_id !== first.round_id ||
        a.publisher !== first.publisher,
    );
    if (mixed) {
      return { success: false, error: 'attestation batch mixes rounds or publishers' };
    }

    const assets = attestations.map((a) =>
      xdr.ScVal.scvBytes(Buffer.from(a.message, 'hex').subarray(0, 8)),
    );
    const prices = attestations.map((a) => nativeToScVal(BigInt(a.price), { type: 'i128' }));
    const sigs = attestations.map((a) => xdr.ScVal.scvBytes(Buffer.from(a.signature, 'hex')));

    return this.invokeContractWriteWithRetry(
      this.noeracleContract,
      'update_batch_ed25519_persistent',
      [
        xdr.ScVal.scvVec(assets),                                  // assets:    Vec<BytesN<8>>
        xdr.ScVal.scvVec(prices),                                  // prices:    Vec<i128>
        nativeToScVal(BigInt(first.timestamp), { type: 'u64' }),   // timestamp: u64
        nativeToScVal(BigInt(first.round_id), { type: 'u64' }),    // round_id:  u64
        xdr.ScVal.scvBytes(Buffer.from(first.publisher, 'hex')),   // pubkey:    BytesN<32>
        xdr.ScVal.scvVec(sigs),                                    // sigs:      Vec<BytesN<64>>
      ],
    );
  }

  /**
   * Permissionless NAV freshener (P1-4): recompute one asset's unrealized
   * trader PnL at the current oracle price and push it to the vault.
   * Non-critical — a single attempt, the next push cycle retries anyway.
   */
  async syncAssetPnl(asset: string): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.marketContract,
      'sync_asset_pnl',
      [nativeToScVal(asset, { type: 'symbol' })],
      { maxRetries: 1 },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Position Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all position IDs. THROWS on read failure — an error is not an
   * empty market (K-4).
   */
  async getAllPositionIds(): Promise<bigint[]> {
    const result = await this.invokeContractRead<unknown>(
      this.marketContract,
      'get_all_position_ids',
      [],
    );
    return toBigIntArray(result);
  }

  /**
   * Get a specific position. Returns null only when the contract says the
   * position does not exist; THROWS on transport/simulation failure.
   */
  async getPosition(positionId: bigint): Promise<Position | null> {
    const result = await this.invokeContractRead<any>(
      this.marketContract,
      'get_position',
      [nativeToScVal(positionId, { type: 'u64' })],
    );
    return result ? this.parsePosition(result) : null;
  }

  /**
   * Preview a liquidation without submitting (P2-9): `is_liquidatable` was
   * removed from the contract, so the simulation of the real `liquidate`
   * call — which re-runs the full margin + funding check on-chain — is the
   * source of truth. A simulation error with #50 means "healthy".
   */
  async simulateLiquidate(positionId: bigint): Promise<SimulationOutcome> {
    return this.simulateCall(this.marketContract, 'liquidate', [
      new Address(this.publicKey).toScVal(),
      nativeToScVal(positionId, { type: 'u64' }),
    ]);
  }

  /**
   * Execute liquidation. Fee-escalates on retries; an indeterminate
   * submission is only rebuilt if the position still exists (K-6).
   */
  async liquidate(positionId: bigint): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.marketContract,
      'liquidate',
      [
        new Address(this.publicKey).toScVal(),
        nativeToScVal(positionId, { type: 'u64' }),
      ],
      {
        escalateFees: true,
        recheck: async () => (await this.getPosition(positionId)) !== null,
      },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Order Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all order IDs. THROWS on read failure (K-4).
   */
  async getAllOrderIds(): Promise<bigint[]> {
    const result = await this.invokeContractRead<unknown>(
      this.marketContract,
      'get_all_order_ids',
      [],
    );
    return toBigIntArray(result);
  }

  /**
   * Get a specific order. Returns null only when it does not exist;
   * THROWS on transport/simulation failure.
   */
  async getOrder(orderId: bigint): Promise<Order | null> {
    const result = await this.invokeContractRead<any>(
      this.marketContract,
      'get_order',
      [nativeToScVal(orderId, { type: 'u64' })],
    );
    return result ? this.parseOrder(result) : null;
  }

  /**
   * Preview an order execution (P2-10): `should_execute_order` was removed
   * from the contract — simulate the real `execute_order` and only submit
   * when the simulation succeeds. #62 in the error means "not triggered".
   */
  async simulateExecuteOrder(orderId: bigint): Promise<SimulationOutcome> {
    return this.simulateCall(this.marketContract, 'execute_order', [
      new Address(this.publicKey).toScVal(),
      nativeToScVal(orderId, { type: 'u64' }),
    ]);
  }

  /**
   * Execute an order. Indeterminate submissions are only rebuilt while the
   * order is still pending on-chain.
   */
  async executeOrder(orderId: bigint): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.marketContract,
      'execute_order',
      [
        new Address(this.publicKey).toScVal(),
        nativeToScVal(orderId, { type: 'u64' }),
      ],
      {
        recheck: async () => {
          const order = await this.getOrder(orderId);
          return order !== null && order.status === 'Pending';
        },
      },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Cross-Margin Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Liquidate a cross-margin account (closes all cross positions). The
   * internal pre-submit simulation rejects healthy accounts with #78
   * before any fee is spent — keep that preflight, but callers should
   * prefilter with local equity math first (K-4).
   */
  async liquidateCrossAccount(trader: string): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.marketContract,
      'liquidate_cross_account',
      [
        new Address(this.publicKey).toScVal(),
        new Address(trader).toScVal(),
      ],
      {
        escalateFees: true,
        recheck: async () => (await this.getCrossMarginPositions(trader)).length > 0,
      },
    );
  }

  /**
   * Get cross-margin position IDs for a trader. THROWS on read failure.
   */
  async getCrossMarginPositions(trader: string): Promise<bigint[]> {
    const result = await this.invokeContractRead<unknown>(
      this.marketContract,
      'get_cross_margin_positions',
      [new Address(trader).toScVal()],
    );
    return toBigIntArray(result);
  }

  /**
   * Get a trader's cross-margin pool balance (for the local equity
   * prefilter). THROWS on read failure.
   */
  async getCrossMarginBalance(trader: string): Promise<bigint> {
    const result = await this.invokeContractRead<bigint | number>(
      this.marketContract,
      'get_cross_margin_balance',
      [new Address(trader).toScVal()],
    );
    return BigInt(result ?? 0);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ADL Functions (L0-1)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Read the on-chain ADL flag for an asset. THROWS on read failure —
   * including "unknown export" against a pre-L0-1 market (callers detect
   * that with isMissingContractFunction and disable the phase).
   */
  async isAdlActive(asset: string): Promise<boolean> {
    const result = await this.invokeContractRead<boolean>(
      this.marketContract,
      'is_adl_active',
      [nativeToScVal(asset, { type: 'symbol' })],
    );
    return result === true;
  }

  /**
   * Preview the permissionless trigger check: the simulated retval is the
   * flag AS IT WOULD BE after the call runs (trigger/clear hysteresis
   * applied on-chain against live vault coverage).
   */
  async simulateCheckAdlTrigger(asset: string): Promise<SimulationOutcome> {
    return this.simulateCall(this.marketContract, 'check_adl_trigger', [
      nativeToScVal(asset, { type: 'symbol' }),
    ]);
  }

  /** Submit check_adl_trigger — flips/clears AdlActive(asset) on-chain. */
  async checkAdlTrigger(asset: string): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(this.marketContract, 'check_adl_trigger', [
      nativeToScVal(asset, { type: 'symbol' }),
    ]);
  }

  /**
   * Auto-deleverage one ranked winner (L0-1). Permissionless; the built-in
   * pre-submit simulation rejects #84 (flag off) / #85 (not a net winner) /
   * #20 (gone) before any fee is spent. Fee-escalates like liquidate —
   * ADL runs during solvency stress, exactly when fees spike.
   */
  async adlClose(positionId: bigint): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.marketContract,
      'adl_close',
      [new Address(this.publicKey).toScVal(), nativeToScVal(positionId, { type: 'u64' })],
      {
        escalateFees: true,
        recheck: async () => (await this.getPosition(positionId)) !== null,
      },
    );
  }

  /**
   * Pool coverage for the local ADL mirror: vault buffer + LP USDC — the
   * same two views check_adl_trigger sums on-chain. THROWS on read failure
   * or when no vault contract id is configured.
   */
  async getVaultCoverage(): Promise<bigint> {
    if (!this.vaultContract) throw new Error('vault contract id not configured');
    const [buffer, totalUsdc] = await Promise.all([
      this.invokeContractRead<bigint | number>(this.vaultContract, 'get_buffer_balance', []),
      this.invokeContractRead<bigint | number>(this.vaultContract, 'get_total_usdc', []),
    ]);
    return BigInt(buffer ?? 0) + BigInt(totalUsdc ?? 0);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Risk Ladder Functions (L0-12)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Per-asset risk params (L0-12 ladder). Returns null when the asset has
   * no params configured; THROWS on transport failure and on a pre-L0-12
   * market (missing export — callers detect with isMissingContractFunction).
   */
  async getAssetRiskMmBps(asset: string): Promise<number | null> {
    const result = await this.invokeContractRead<{ mm_bps?: number | bigint } | null>(
      this.marketContract,
      'get_asset_risk',
      [nativeToScVal(asset, { type: 'symbol' })],
    );
    if (result == null || result.mm_bps == null) return null;
    return Number(result.mm_bps);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Vault Factory Functions (L0-20)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Which factory vault (if any) owns an order. Returns null for
   * non-factory orders or when no factory is configured. THROWS on
   * transport failure and on a pre-L0-20 factory (missing export) —
   * callers detect the latter with isMissingContractFunction.
   */
  async getOrderVault(orderId: bigint): Promise<number | null> {
    if (!this.factoryContract) return null;
    const result = await this.invokeContractRead<number | bigint | null>(
      this.factoryContract,
      'get_order_vault',
      [nativeToScVal(orderId, { type: 'u64' })],
    );
    return result == null ? null : Number(result);
  }

  /**
   * Permissionless L0-20 reconcile: binds an executed factory-vault order
   * to its created position (or credits a cancel refund) so the vault's
   * full-NAV stops under-counting. InvalidParameter (#3) = order still
   * Pending (e.g. stop→limit phase transition) — callers skip quietly.
   */
  async reconcileOrder(vaultId: number, orderId: bigint): Promise<ExecutionResult> {
    if (!this.factoryContract) {
      return { success: false, error: 'vault factory contract id not configured' };
    }
    return this.invokeContractWriteWithRetry(this.factoryContract, 'reconcile_order', [
      nativeToScVal(vaultId, { type: 'u32' }),
      nativeToScVal(orderId, { type: 'u64' }),
    ]);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Trailing Stop Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Preview a trailing-peak update (K-5): the contract returns Ok(false)
   * for no-ops, so submit only when the simulated return value is true.
   */
  async simulateUpdateTrailingPeak(orderId: bigint): Promise<SimulationOutcome> {
    return this.simulateCall(this.marketContract, 'update_trailing_peak', [
      nativeToScVal(orderId, { type: 'u64' }),
    ]);
  }

  /**
   * Update trailing stop peak for a single order
   */
  async updateTrailingPeak(orderId: bigint): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.marketContract,
      'update_trailing_peak',
      [nativeToScVal(orderId, { type: 'u64' })],
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Funding Rate Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Apply funding rate (hourly). #55 (FundingIntervalNotElapsed) comes
   * back as a fast non-retryable failure — the caller classifies it as
   * 'not-due' (K-7 tri-state).
   */
  async applyFunding(): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.marketContract,
      'apply_funding',
      [],
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Internal Helpers
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Invoke a contract function (read-only). THROWS on transport or
   * simulation failure — callers must not treat errors as empty results.
   */
  private async invokeContractRead<T>(
    contract: Contract,
    method: string,
    args: xdr.ScVal[] = [],
  ): Promise<T> {
    const tx = new TransactionBuilder(this.simulationSource(), {
      fee: READ_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    const response = await this.withRpc((server) => server.simulateTransaction(tx));

    if (rpc.Api.isSimulationError(response)) {
      throw new Error(`Simulation failed: ${response.error}`);
    }

    if (!response.result) {
      throw new Error('No result from simulation');
    }

    return scValToNative(response.result.retval) as T;
  }

  /**
   * Simulate a WRITE entry point without submitting (simulate-before-submit
   * pattern). Simulation errors (contract rejections) are returned as
   * `{ ok: false }`; transport failures still THROW so callers can count
   * read failures separately from business rejections.
   */
  private async simulateCall(
    contract: Contract,
    method: string,
    args: xdr.ScVal[],
  ): Promise<SimulationOutcome> {
    const tx = new TransactionBuilder(this.simulationSource(), {
      fee: READ_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    const response = await this.withRpc((server) => server.simulateTransaction(tx));

    if (rpc.Api.isSimulationError(response)) {
      return { ok: false, error: response.error };
    }

    return {
      ok: true,
      retval: response.result ? scValToNative(response.result.retval) : undefined,
    };
  }

  /**
   * Invoke a contract function (write) with retry logic
   */
  private async invokeContractWriteWithRetry(
    contract: Contract,
    method: string,
    args: xdr.ScVal[] = [],
    options: WriteOptions = {},
  ): Promise<ExecutionResult> {
    const maxRetries = options.maxRetries ?? MAX_RETRIES;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Fee escalation (K-6): 2× inclusion fee per retry, capped.
      const inclusionFee = options.escalateFees
        ? Math.min(BASE_INCLUSION_FEE * 2 ** (attempt - 1), MAX_INCLUSION_FEE)
        : BASE_INCLUSION_FEE;

      try {
        return await this.invokeContractWrite(contract, method, args, inclusionFee);
      } catch (error) {
        if (error instanceof TxIndeterminateError) {
          // The tx may still land. Re-check on-chain state before rebuilding
          // a duplicate; without a recheck, never resubmit blindly (K-6).
          lastError = error.message;
          let stillNeeded = false;
          if (options.recheck) {
            try {
              stillNeeded = await options.recheck();
            } catch {
              stillNeeded = false; // can't verify → don't risk a duplicate
            }
          }
          if (!stillNeeded || attempt === maxRetries) {
            return {
              success: false,
              indeterminate: true,
              txHash: error.txHash,
              error: error.message,
            };
          }
        } else {
          lastError = error instanceof Error ? error.message : String(error);
          // Don't retry business-logic rejections (not transient)
          if (isNonRetryableContractError(lastError)) {
            return { success: false, error: lastError };
          }
        }

        if (attempt < maxRetries) {
          await this.sleep(RETRY_DELAY_MS);
        }
      }
    }

    return { success: false, error: lastError };
  }

  /**
   * Invoke a contract function (write)
   */
  private async invokeContractWrite(
    contract: Contract,
    method: string,
    args: xdr.ScVal[] = [],
    inclusionFee: number = BASE_INCLUSION_FEE,
  ): Promise<ExecutionResult> {
    const account = await this.getAccount();

    // Build transaction
    let tx = new TransactionBuilder(account, {
      fee: String(inclusionFee),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    // Simulate to get fees and resources
    const simResponse = await this.withRpc((server) => server.simulateTransaction(tx));

    if (rpc.Api.isSimulationError(simResponse)) {
      throw new Error(`Simulation failed: ${simResponse.error}`);
    }

    // Prepare transaction with resources from simulation
    tx = rpc.assembleTransaction(tx, simResponse).build();

    // Sign
    tx.sign(this.keypair);

    // Submit with retry on TRY_AGAIN_LATER
    let sendResponse;
    for (let sendAttempt = 0; sendAttempt < 3; sendAttempt++) {
      sendResponse = await this.withRpc((server) => server.sendTransaction(tx));

      if (sendResponse.status === 'PENDING') break;

      if (sendResponse.status === 'TRY_AGAIN_LATER') {
        await this.sleep(3000);
        // Re-fetch account for fresh sequence number
        const freshAccount = await this.getAccount();
        tx = new TransactionBuilder(freshAccount, {
          fee: String(inclusionFee),
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(contract.call(method, ...args))
          .setTimeout(TX_TIMEOUT_SECONDS)
          .build();
        const freshSim = await this.withRpc((server) => server.simulateTransaction(tx));
        if (rpc.Api.isSimulationError(freshSim)) {
          throw new Error(`Simulation failed on retry: ${freshSim.error}`);
        }
        tx = rpc.assembleTransaction(tx, freshSim).build();
        tx.sign(this.keypair);
        continue;
      }

      if (sendResponse.status === 'ERROR') {
        const errDetail = (sendResponse as any).errorResult
          ? JSON.stringify((sendResponse as any).errorResult).slice(0, 200)
          : 'no detail';
        throw new Error(`Transaction send failed: ${errDetail}`);
      }

      throw new Error(`Unexpected send status: ${sendResponse.status}`);
    }

    if (!sendResponse || sendResponse.status !== 'PENDING') {
      throw new Error(`Transaction not accepted after retries: ${sendResponse?.status}`);
    }

    const txHash = sendResponse.hash;

    // Wait for confirmation — the polling window matches TX_TIMEOUT_SECONDS
    let getResponse = await this.withRpc((server) => server.getTransaction(txHash));
    let pollAttempts = 0;

    while (getResponse.status === 'NOT_FOUND' && pollAttempts < CONFIRM_POLL_ATTEMPTS) {
      await this.sleep(CONFIRM_POLL_DELAY_MS);
      getResponse = await this.withRpc((server) => server.getTransaction(txHash));
      pollAttempts++;
    }

    if (getResponse.status === 'SUCCESS') {
      // Try to extract reward from return value
      let reward: bigint | undefined;
      if (getResponse.returnValue) {
        try {
          reward = scValToNative(getResponse.returnValue) as bigint;
        } catch {
          // Ignore parse errors
        }
      }
      return { success: true, txHash, reward };
    }

    if (getResponse.status === 'NOT_FOUND') {
      // Still unseen after the whole window: with timeBounds ≈ the window
      // it PROBABLY expired, but it can still land in a ledger that closes
      // right after — indeterminate, never a clean failure (K-6).
      throw new TxIndeterminateError(txHash);
    }

    throw new Error(`Transaction failed: ${getResponse.status}`);
  }

  /**
   * Parse raw position data from contract.
   * Field set matches the CURRENT Position struct in
   * noether_common/src/types.rs (entry_cumulative_funding — the old
   * last_funding_time/accumulated_funding fields no longer exist).
   */
  private parsePosition(raw: any): Position {
    return {
      id: BigInt(raw.id),
      trader: raw.trader,
      asset: raw.asset,
      collateral: BigInt(raw.collateral),
      size: BigInt(raw.size),
      entry_price: BigInt(raw.entry_price),
      direction: raw.direction === 0 ? 'Long' : 'Short',
      leverage: Number(raw.leverage),
      liquidation_price: BigInt(raw.liquidation_price),
      timestamp: BigInt(raw.timestamp),
      entry_cumulative_funding: BigInt(raw.entry_cumulative_funding ?? 0),
      margin_mode: Number(raw.margin_mode ?? 0),
    };
  }

  /**
   * Parse raw order data from contract
   */
  private parseOrder(raw: any): Order {
    const orderTypeMap: Record<number, Order['order_type']> = {
      0: 'LimitEntry',
      1: 'StopLoss',
      2: 'TakeProfit',
      3: 'StopLimit',
      4: 'TrailingStop',
    };

    const statusMap: Record<number, Order['status']> = {
      0: 'Pending',
      1: 'Executed',
      2: 'Cancelled',
      3: 'CancelledSlippage',
      4: 'Expired',
    };

    return {
      id: BigInt(raw.id),
      trader: raw.trader,
      asset: raw.asset,
      order_type: orderTypeMap[raw.order_type] || 'LimitEntry',
      direction: raw.direction === 0 ? 'Long' : 'Short',
      collateral: BigInt(raw.collateral),
      leverage: Number(raw.leverage),
      trigger_price: BigInt(raw.trigger_price),
      trigger_condition: raw.trigger_condition === 0 ? 'Above' : 'Below',
      slippage_tolerance_bps: Number(raw.slippage_tolerance_bps),
      position_id: BigInt(raw.position_id),
      has_position: Boolean(raw.has_position),
      created_at: BigInt(raw.created_at),
      status: statusMap[raw.status] || 'Pending',
      limit_price: BigInt(raw.limit_price ?? 0),
      trailing_percent_bps: Number(raw.trailing_percent_bps ?? 0),
      time_in_force: Number(raw.time_in_force ?? 0),
      stop_limit_phase: Number(raw.stop_limit_phase ?? 0),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Normalize a simulated Vec<u64> into bigint[]. */
function toBigIntArray(result: unknown): bigint[] {
  if (!Array.isArray(result)) return [];
  return result.map((id) => {
    if (typeof id === 'bigint') return id;
    if (typeof id === 'number' || typeof id === 'string') return BigInt(id);
    return BigInt(0);
  });
}
