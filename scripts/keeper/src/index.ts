/**
 * Noether Keeper Bot
 *
 * A unified keeper bot that handles:
 * 1. Oracle publishing — fetches signed attestations from Noeracle's
 *    attestation service and publishes them to the on-chain Noeracle
 *    contract's persistent storage so the noeracle_shim → oracle_adapter
 *    → market read path stays fresh.
 * 2. Position liquidations (monitors positions, liquidates when underwater)
 * 3. Order executions (limit orders, stop-loss, take-profit)
 * 4. Funding rate application (hourly)
 *
 * Reliability (2026-06 audit K-1..K-8):
 * - Watchdog: exits(1) when no cycle completes within WATCHDOG_TIMEOUT_MS —
 *   Railway restarts the process (that IS the recovery path).
 * - Webhook alerting (Discord/Telegram) on startup, shutdown, watchdog,
 *   error streaks, circuit-breaker trips, read-failure streaks.
 * - One market snapshot per cycle shared by all scan phases; liquidation
 *   health is computed LOCALLY (is_liquidatable was removed on-chain) and
 *   confirmed by simulating the real liquidate/execute_order call before
 *   any submission.
 * - Publish-path defenses: persisted circuit breaker, per-asset jump
 *   bounds + absolute sanity bands, independent reference ticker check.
 *
 * Usage:
 *   npm start        - Build + run the compiled keeper (production)
 *   npm run dev      - Start with auto-reload (ts-node-dev)
 *   npm run smoke    - Offline smoke test of the local health math
 */

import { loadConfig } from './config';
import {
  StellarClient,
  extractContractErrorCode,
  isMissingContractFunction,
  RouterRound,
} from './stellar';
import {
  ExecutionResult,
  FundingOutcome,
  KeeperConfig,
  KeeperState,
  KeeperStats,
  Order,
  Position,
  PriceData,
} from './types';
import { trackTriggeredStuck } from './deadman';
import { initAlerts, sendAlert } from './alerts';
import { loadKeeperState, saveKeeperState } from './state';
import {
  DEFAULT_MAINTENANCE_MARGIN_BPS,
  adlFlagDecision,
  assetPayableUpnl,
  crossEquity,
  isCrossLiquidationCandidate,
  isLiquidationCandidate,
  positionMargin,
  rankAdlCandidates,
} from './health';
import { getReferencePrice } from './reference';
import { getStorkPrice, getStorkStatus, refreshStorkPrices } from './stork';
import { sendHeartbeat } from './heartbeat';

// Type-only imports — the @noeracle/sdk package is ESM-only, so the runtime
// load happens via dynamic import() inside getNoeracle().
import type { Noeracle as NoeracleClient, Attestation } from '@noeracle/sdk';

// ASCII art banner
const BANNER = `
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║     _   _            _   _                 _  __                              ║
║    | \\ | | ___   ___| |_| |__   ___ _ __  | |/ /___  ___ _ __   ___ _ __      ║
║    |  \\| |/ _ \\ / _ \\ __| '_ \\ / _ \\ '__| | ' // _ \\/ _ \\ '_ \\ / _ \\ '__|     ║
║    | |\\  | (_) |  __/ |_| | | |  __/ |    | . \\  __/  __/ |_) |  __/ |        ║
║    |_| \\_|\\___/ \\___|\\__|_| |_|\\___|_|    |_|\\_\\___|\\___| .__/ \\___|_|        ║
║                                                         |_|                   ║
║                     Unified Keeper Bot v2.1                                   ║
║           Oracle Updates | Liquidations | Order Execution                     ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`;

// ── Cycle/scan tuning ────────────────────────────────────────────────────
/** How often the watchdog re-checks the heartbeat. */
const WATCHDOG_CHECK_INTERVAL_MS = 30_000;
/** Bound on the Noeracle attestation fetch (the SDK takes no signal — raced). */
const NOERACLE_FETCH_TIMEOUT_MS = 10_000;
/** Delay between per-asset oracle pushes (sequence-conflict avoidance). */
const ORACLE_INTER_ASSET_DELAY_MS = 4_000;
/** Consecutive whole-snapshot read failures before alert + backoff (K-4). */
const READ_FAILURE_ALERT_THRESHOLD = 3;
const READ_FAILURE_BACKOFF_MS = 10_000;
/**
 * Safety net for the local prefilters: every FULL_SWEEP_INTERVAL_MS the
 * keeper simulates ALL positions/cross accounts regardless of local health
 * math, bounding any drift the prefilter cannot see (pending funding).
 */
const FULL_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
/** Cross-margin pool balances change rarely — cache for the old scan interval. */
const CROSS_BALANCE_CACHE_MS = 60_000;
/** Vault coverage (buffer + LP USDC) for the ADL mirror — 30s cache (L0-1). */
const VAULT_COVERAGE_CACHE_MS = 30_000;
/** Per-asset mm_bps for the prefilters — risk params change rarely (L0-12). */
const ASSET_RISK_CACHE_MS = 10 * 60 * 1000;
/**
 * Round sourcing for router executions (L0-19): a cached round ≤15s old is
 * already fresher than the 30s publish cadence — use it without an HTTP
 * hop; past that do ONE fresh fetch; past the on-chain staleness bound the
 * round is useless and the caller falls back to the direct market call.
 */
const ROUND_FRESH_FAST_PATH_MS = 15_000;
const ROUND_MAX_AGE_MS = 60_000;
/** Funding cadence (K-7): contract enforces 1h; 30s slack avoids an early #55. */
const FUNDING_INTERVAL_MS = 60 * 60 * 1000 + 30_000;
const FUNDING_NOT_DUE_RETRY_MS = 5 * 60 * 1000;
const FUNDING_FAILED_RETRY_MS = 60_000;
const FUNDING_FAILURE_ALERT_THRESHOLD = 3;
/** Noisy per-entity log lines are throttled to once per this window. */
const THROTTLED_LOG_INTERVAL_MS = 10 * 60 * 1000;

/** Market state snapshot fetched once per cycle and shared by all phases (K-4). */
interface CycleSnapshot {
  positions: Position[];
  orders: Order[];
}

/** Race a promise against a timeout (for SDK calls that take no AbortSignal). */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

class KeeperBot {
  private config: KeeperConfig;
  private stellar: StellarClient;
  private isRunning: boolean = false;
  private shuttingDown: boolean = false;
  private stats: KeeperStats;
  private state: KeeperState;
  private lastOracleUpdate: number = 0;
  private oracleUpdateInProgress: boolean = false;
  private currentPrices: Map<string, PriceData> = new Map();
  private noeracleClient: NoeracleClient | null = null;

  // Reliability bookkeeping (K-1/K-4/K-7)
  private lastCycleCompletedAt: number = Date.now();
  private watchdogTimer: NodeJS.Timeout | null = null;
  private consecutiveCycleErrors: number = 0;
  private consecutiveReadFailures: number = 0;
  private fundingFailureStreak: number = 0;
  private nextFundingAttemptAt: number = 0;
  private lastFullSweepAt: number = 0;
  private crossBalanceCache: Map<string, { balance: bigint; fetchedAt: number }> = new Map();
  private orphanedOrderIds: Set<string> = new Set();
  // ADL manager (L0-1)
  /** Last known on-chain ADL flag per asset (probe-synced). */
  private adlActive: Map<string, boolean> = new Map();
  /** Per-asset throttle on check_adl_trigger probes while the flag is off. */
  private adlLastProbeAt: Map<string, number> = new Map();
  /** undefined = unknown; false = deployed market predates L0-1 (phase inert). */
  private adlSupported: boolean | undefined;
  private adlUnsupportedLogged = false;
  private vaultCoverageCache?: { value: bigint; fetchedAt: number };
  // Factory reconcile duty (L0-20)
  /** undefined = unknown; false = deployed factory predates L0-20 (duty inert). */
  private factoryReconcileSupported: boolean | undefined;
  private factoryReconcileUnsupportedLogged = false;
  // Per-asset risk ladder (L0-12)
  /** Prefilter mm_bps per asset, 10-min cached. */
  private assetMmBpsCache: Map<string, { mmBps: bigint; fetchedAt: number }> = new Map();
  /** undefined = unknown; false = deployed market predates L0-12 (legacy mm). */
  private riskLadderSupported: boolean | undefined;
  // Router execution path (L0-19)
  /** Latest defense-passed signed round per symbol (execution relays). */
  private latestRounds: Map<string, { att: Attestation; cachedAt: number }> = new Map();
  /** Per-entrypoint support: adl_with_price is Batch-1-only while
   *  execute/liquidate/cross shipped with the deployed routers. */
  private routerFnSupported: Map<string, boolean> = new Map();
  /** Dead-man counters: triggered-but-still-pending cycles per order id. */
  private triggeredStuckCounts: Map<string, number> = new Map();
  /** L0-9 interim two-strike: consecutive liquidatable reads per key
   *  (`iso:<id>` / `cross:<trader>`). Cleared on any healthy read. */
  private liqStrikes: Map<string, number> = new Map();
  /** L0-9 spike-alert throttle: last alert ms epoch per symbol. */
  private spikeAlertAt: Map<string, number> = new Map();
  private throttledLogAt: Map<string, number> = new Map();
  private nextTtlBumpAt: number = 0; // P3-9

  constructor() {
    this.config = loadConfig();
    this.stellar = new StellarClient(this.config);
    this.state = loadKeeperState(this.config.stateFilePath);
    this.stats = {
      startTime: new Date(),
      oracleUpdates: 0,
      liquidationsExecuted: 0,
      ordersExecuted: 0,
      ordersCancelledSlippage: 0,
      ordersSkippedOrphaned: 0,
      totalRewardsEarned: BigInt(0),
      errors: 0,
      priceSkips: 0,
      readFailures: 0,
      syncPnlPushes: 0,
      trailingPeakUpdates: 0,
      fundingApplications: 0,
      adlCloses: 0,
      adlFlagFlips: 0,
      ordersReconciled: 0,
      routerExecutions: 0,
    };
  }

  /**
   * Start the keeper bot
   */
  async start(): Promise<void> {
    console.log(BANNER);
    console.log('Starting Noether Keeper Bot...\n');

    // Validate configuration
    if (!this.config.marketContractId) {
      console.error('❌ Market contract ID not configured.');
      console.error('   Set NEXT_PUBLIC_MARKET_ID in .env or deploy contracts first.');
      process.exit(1);
    }

    if (!this.config.noeracleContractId) {
      console.error('❌ Noeracle contract ID not configured.');
      console.error('   Set NEXT_PUBLIC_NOERACLE_ID in .env (default: testnet Noeracle).');
      process.exit(1);
    }

    initAlerts({
      discordWebhookUrl: this.config.discordWebhookUrl,
      telegramBotToken: this.config.telegramBotToken,
      telegramChatId: this.config.telegramChatId,
      instanceId: this.config.instanceId,
    });

    // Seed the price circuit breaker from persisted state (K-2)
    for (const [symbol, persisted] of Object.entries(this.state.lastPushedPrices)) {
      this.currentPrices.set(symbol, {
        asset: symbol,
        price: persisted.price,
        priceScaled: BigInt(persisted.priceScaled),
        timestamp: persisted.timestamp,
      });
    }

    // Funding schedule from persisted last-submit time (K-7)
    this.nextFundingAttemptAt = this.state.lastFundingSubmitTime
      ? this.state.lastFundingSubmitTime + FUNDING_INTERVAL_MS
      : Date.now();

    console.log('Configuration:');
    console.log(`  Network:           ${this.config.network}`);
    console.log(`  RPC URLs:          ${this.config.rpcUrls.join(' → ')}`);
    console.log(`  Keeper Address:    ${this.stellar.publicKey}`);
    console.log(`  Market Contract:   ${this.config.marketContractId.slice(0, 8)}...`);
    console.log(`  Noeracle Contract: ${this.config.noeracleContractId.slice(0, 8)}...`);
    console.log(`  Poll Interval:     ${this.config.pollIntervalMs}ms`);
    console.log(`  Oracle Interval:   ${this.config.oracleUpdateIntervalMs}ms`);
    console.log(`  Watchdog:          exit after ${this.config.watchdogTimeoutMs}ms without a completed cycle`);
    console.log(`  Instance:          ${this.config.instanceId}${this.config.pollOffsetMs > 0 ? ` (poll offset ${this.config.pollOffsetMs}ms)` : ''}`);
    console.log(`  Router:            ${this.config.routerContractId ? `${this.config.routerContractId.slice(0, 8)}… (verify-then-trade preferred)` : 'not configured (direct market calls only)'}`);
    console.log(`  Healthcheck:       ${this.config.healthcheckUrl ? 'enabled' : 'disabled'}`);
    console.log(`  State File:        ${this.config.stateFilePath}`);
    console.log(`  Assets:            ${this.config.assets.map(a => `${a.symbol} (±${a.maxMovePct}%, $${a.minPrice}-$${a.maxPrice})`).join(', ')}`);
    console.log('');

    this.isRunning = true;

    // Handle graceful shutdown
    process.on('SIGINT', () => { void this.stop(); });
    process.on('SIGTERM', () => { void this.stop(); });

    // Watchdog (K-1): if no cycle completes in time, exit — Railway restarts.
    this.lastCycleCompletedAt = Date.now();
    this.watchdogTimer = setInterval(() => this.checkWatchdog(), WATCHDOG_CHECK_INTERVAL_MS);

    void sendAlert(
      'info',
      'Keeper started',
      `network=${this.config.network} keeper=${this.stellar.publicKey} market=${this.config.marketContractId.slice(0, 8)}…`,
    );
    if (this.config.keySource === 'ADMIN_SECRET_KEY') {
      void sendAlert(
        'warn',
        'Keeper signing with ADMIN_SECRET_KEY fallback',
        'Set a dedicated KEEPER_SECRET_KEY — admin key exposure on the keeper box is unnecessary blast radius.',
      );
    }

    console.log('🚀 Keeper bot started. Monitoring...\n');
    console.log('═'.repeat(80) + '\n');

    // L0-19: stagger active-active instances — the second instance sets
    // KEEPER_POLL_OFFSET_MS ≈ pollIntervalMs/2 so the pair halves the
    // effective heartbeat instead of racing in phase.
    if (this.config.pollOffsetMs > 0) {
      await this.sleep(this.config.pollOffsetMs);
    }

    // Main loop
    while (this.isRunning) {
      try {
        await this.runKeeperCycle();
        this.consecutiveCycleErrors = 0;
      } catch (error) {
        console.error('Error in keeper loop:', error);
        this.stats.errors++;
        this.consecutiveCycleErrors++;
        if (this.consecutiveCycleErrors >= this.config.alertErrorStreak) {
          void sendAlert(
            'critical',
            'Keeper cycle error streak',
            `${this.consecutiveCycleErrors} consecutive cycle errors. Latest: ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
      }

      // Heartbeat: the cycle ran to completion (watchdog watches for hangs).
      this.lastCycleCompletedAt = Date.now();
      // L0-19: dead-man ping — silence at healthchecks.io means BOTH
      // instances are down (or wedged), independent of the alert path.
      this.pingHealthcheck();

      await this.sleep(this.config.pollIntervalMs);
    }
  }

  /**
   * Watchdog (K-1): a hung RPC/fetch used to freeze the loop forever while
   * Railway saw a healthy process. Every request now carries a timeout, and
   * as a second line of defense the process exits when no cycle completed
   * within the window — Railway's restart is the recovery path.
   */
  private checkWatchdog(): void {
    if (!this.isRunning || this.shuttingDown) return;
    const sinceLastCycle = Date.now() - this.lastCycleCompletedAt;
    if (sinceLastCycle <= this.config.watchdogTimeoutMs) return;

    console.error(
      `\n💀 WATCHDOG: no completed keeper cycle in ${Math.round(sinceLastCycle / 1000)}s ` +
      `(limit ${Math.round(this.config.watchdogTimeoutMs / 1000)}s) — exiting for restart`,
    );
    // Best-effort alert, then exit no matter what.
    const hardExit = setTimeout(() => process.exit(1), 6_000);
    void sendAlert(
      'critical',
      'Keeper watchdog triggered — process exiting',
      `No completed cycle in ${Math.round(sinceLastCycle / 1000)}s. Railway should restart the keeper; investigate if this repeats.`,
    ).finally(() => {
      clearTimeout(hardExit);
      process.exit(1);
    });
  }

  /**
   * Stop the keeper bot
   */
  async stop(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.isRunning = false;
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);

    console.log('\n\n' + '═'.repeat(80));
    console.log('Shutting down keeper bot...\n');
    console.log('Session Statistics:');
    console.log(`  Runtime:               ${this.formatDuration(Date.now() - this.stats.startTime.getTime())}`);
    console.log(`  Oracle Updates:        ${this.stats.oracleUpdates}`);
    console.log(`  Price Pushes Skipped:  ${this.stats.priceSkips} (circuit breaker / bands / reference)`);
    console.log(`  Liquidations:          ${this.stats.liquidationsExecuted}`);
    console.log(`  Orders Executed:       ${this.stats.ordersExecuted}`);
    console.log(`  Orders Cancelled:      ${this.stats.ordersCancelledSlippage} (slippage)`);
    console.log(`  Orders Skipped:        ${this.stats.ordersSkippedOrphaned} (orphaned - position closed)`);
    console.log(`  Trailing Peak Updates: ${this.stats.trailingPeakUpdates}`);
    console.log(`  ADL Closes: ${this.stats.adlCloses} (flag flips: ${this.stats.adlFlagFlips})`);
    console.log(`  Factory Orders Reconciled: ${this.stats.ordersReconciled}`);
    console.log(`  Router Executions: ${this.stats.routerExecutions}`);
    console.log(`  Funding Applications:  ${this.stats.fundingApplications}`);
    console.log(`  PnL Syncs:             ${this.stats.syncPnlPushes}`);
    console.log(`  Total Rewards:         ${this.formatAmount(this.stats.totalRewardsEarned)} USDC`);
    console.log(`  Errors:                ${this.stats.errors} (read failures: ${this.stats.readFailures})`);
    console.log('═'.repeat(80) + '\n');

    saveKeeperState(this.config.stateFilePath, this.state);
    await sendAlert(
      'info',
      'Keeper shutting down (graceful)',
      `runtime=${this.formatDuration(Date.now() - this.stats.startTime.getTime())} liquidations=${this.stats.liquidationsExecuted} errors=${this.stats.errors}`,
    );
    process.exit(0);
  }

  /**
   * Run a single keeper cycle
   */
  private async runKeeperCycle(): Promise<void> {
    const now = Date.now();
    const timestamp = new Date().toLocaleTimeString();

    // 1. Update oracle prices (every oracleUpdateIntervalMs) - await to ensure completion
    let pushedAssets: string[] = [];
    if (now - this.lastOracleUpdate >= this.config.oracleUpdateIntervalMs && !this.oracleUpdateInProgress) {
      this.lastOracleUpdate = now;
      this.oracleUpdateInProgress = true;
      try {
        pushedAssets = await this.updateOraclePrices();
      } catch (e) {
        console.error('\n❌ Oracle update cycle error:', e);
        this.stats.errors++;
      } finally {
        this.oracleUpdateInProgress = false;
      }

      // Oracle-health heartbeat (T3-D1): one self-report per oracle cycle,
      // fire-and-forget, including cycles that pushed nothing — a silent
      // keeper is exactly what the health endpoint needs to expose.
      sendHeartbeat(this.config, {
        ts: Date.now(),
        pushed: pushedAssets,
        stork: getStorkStatus(this.config),
        stats: {
          oracleUpdates: this.stats.oracleUpdates,
          priceSkips: this.stats.priceSkips,
          errors: this.stats.errors,
        },
      });
    }

    // 2. One market snapshot per cycle, shared across all scan phases (K-4).
    //    null means the READS FAILED (not "nothing to do") — skip the scans.
    const snapshot = await this.buildSnapshot();
    if (snapshot) {
      const fullSweep = now - this.lastFullSweepAt >= FULL_SWEEP_INTERVAL_MS;
      if (fullSweep) this.lastFullSweepAt = now;

      // 3. Liquidations (isolated + cross-margin)
      await this.checkLiquidations(snapshot, fullSweep);
      await this.checkCrossMarginLiquidations(snapshot, fullSweep);

      // 4. Trailing stop peaks — only in cycles where an oracle push actually
      //    happened (K-5: the peak can only move when the price moved).
      if (pushedAssets.length > 0) {
        await this.updateTrailingStopPeaks(snapshot);
      }

      // 5. Order execution (simulate-first)
      await this.checkOrders(snapshot);

      // 5.5 ADL manager (L0-1) — advisory ranking authority; quiet no-op
      //     until the deployed market exports the ADL entry points.
      await this.manageAdl(snapshot, fullSweep);
    }

    // 6. Apply funding rate (hourly, tri-state — K-7)
    await this.maybeApplyFunding(Date.now());

    // 7. Proactive TTL bump + wallet-funding alarm (P3-9/P3-10)
    await this.maybeBumpTtls(Date.now());

    // Status line
    const priceStr = this.config.assets
      .map(a => {
        const p = this.currentPrices.get(a.symbol);
        return p ? `${a.symbol}:$${p.price.toLocaleString()}` : '';
      })
      .filter(Boolean)
      .join(' | ');

    process.stdout.write(`\r[${this.config.instanceId} ${timestamp}] ${priceStr}    `);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Oracle Updates
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Fetch fresh signed attestations from Noeracle and publish them to the
   * Noeracle contract's persistent storage on-chain.
   *
   * The keeper acts as the on-chain publisher for the public attestation
   * service — fetches the latest signed round from api.noeracle.org and
   * relays it in ONE batched transaction to the hardened
   * `update_batch_ed25519_persistent` so anyone (shim, off-chain readers)
   * can call `get_price_pers(tag)` and see a fresh, publisher-gated,
   * cryptographically-verified price.
   *
   * Publish-path defenses (K-2), applied per asset BEFORE pushing:
   *  1. finite/positive check;
   *  2. absolute sanity band (BTC $1k-$1M, ETH $50-$100k, XLM $0.01-$100);
   *  3. per-asset jump bound vs the last pushed price (persisted across
   *     restarts) — waived only when the last push is stale enough that a
   *     large legitimate move is plausible;
   *  4. independent reference ticker — divergence > threshold skips the
   *     push; an UNREACHABLE reference does not (availability > paranoia).
   *
   * Fail-loud: if Noeracle is unreachable or returns no attestations we
   * log the error and skip the cycle. There is no fallback by design —
   * we want loud breakage so we notice when the oracle pipeline regresses.
   *
   * @returns symbols that were successfully pushed this cycle.
   */
  private async updateOraclePrices(): Promise<string[]> {
    const pushed: string[] = [];

    let attestations: readonly Attestation[];
    try {
      const fresh = await this.fetchNoeracleFresh();
      attestations = fresh.attestations;
    } catch (error) {
      console.error(`\n❌ Noeracle fetch failed: ${error instanceof Error ? error.message : error}`);
      console.error(`   Oracle update skipped this cycle — no fallback by design.`);
      this.stats.errors++;
      return pushed;
    }

    if (attestations.length === 0) {
      console.error(`\n❌ Noeracle returned 0 attestations — skipping oracle update.`);
      this.stats.errors++;
      return pushed;
    }

    // Stork secondary oracle (T3-D1): one batched fetch per cycle so the
    // per-asset defense below can cross-check. No key / unreachable →
    // no-op (fail-open); the defense simply sees "no data".
    await refreshStorkPrices(this.config, this.config.assets.map(a => a.symbol));

    // Validate every asset first (K-2 defenses unchanged, per asset), then
    // push the survivors as ONE batched transaction per cycle — the hardened
    // update_batch_ed25519_persistent takes a whole round in one call, so
    // the old per-asset tx loop (and its inter-asset sequence delays) is gone.
    const eligible: Attestation[] = [];
    const symbolByPair = new Map<string, string>();
    for (const asset of this.config.assets) {
      const pair = `${asset.symbol}/USD`;
      const attestation = attestations.find(a => a.asset === pair);
      if (!attestation) {
        console.warn(`\n⚠️  No attestation returned for ${pair} — skipping`);
        continue;
      }

      const priceHuman = attestation.price_human;
      if (!isFinite(priceHuman) || priceHuman <= 0) {
        console.warn(`\n⚠️  Invalid price for ${asset.symbol}: ${priceHuman} — skipping`);
        continue;
      }

      if (!(await this.passesPublishDefenses(asset.symbol, attestation))) {
        continue;
      }

      eligible.push(attestation);
      symbolByPair.set(attestation.asset, asset.symbol);
      // L0-19: defense-passed rounds double as execution relays.
      this.latestRounds.set(asset.symbol, { att: attestation, cachedAt: Date.now() });
    }

    if (eligible.length === 0) {
      return pushed;
    }

    // The batch entrypoint verifies one (timestamp, round_id, publisher) per
    // call. A normal fetch is one signing round already; if a fetch ever
    // straddles rounds, push the largest group (highest round on ties) and
    // let the stragglers catch up next cycle.
    const groups = new Map<string, Attestation[]>();
    for (const att of eligible) {
      const key = `${att.round_id}:${att.timestamp}:${att.publisher}`;
      const group = groups.get(key);
      if (group) group.push(att);
      else groups.set(key, [att]);
    }
    const batch = [...groups.values()].sort(
      (a, b) =>
        b.length - a.length ||
        Number(BigInt(b[0].round_id) - BigInt(a[0].round_id)),
    )[0];
    if (batch.length < eligible.length) {
      console.warn(
        `\n⚠️  Attestation fetch straddled rounds: pushing ${batch.length}/${eligible.length}, rest next cycle`,
      );
    }

    try {
      const result = await this.stellar.updateNoeracleBatchPersistent(batch);

      if (result.success) {
        for (const attestation of batch) {
          const symbol = symbolByPair.get(attestation.asset);
          if (!symbol) continue;
          // L0-9 spike flag: compare against the previous PUSHED price
          // before overwriting it. Alert-only — the push already landed.
          const previous = this.currentPrices.get(symbol);
          if (previous && previous.priceScaled > 0n && this.config.spikeAlertPct > 0) {
            const delta = BigInt(attestation.price) - previous.priceScaled;
            const deltaPct =
              (Math.abs(Number(delta)) / Number(previous.priceScaled)) * 100;
            if (deltaPct > this.config.spikeAlertPct) {
              this.alertSpike(symbol, previous.price, attestation.price_human, deltaPct);
            }
          }
          this.currentPrices.set(symbol, {
            asset: symbol,
            price: attestation.price_human,
            priceScaled: BigInt(attestation.price),
            timestamp: Date.now(),
          });
          // Persist so the circuit breaker survives restarts (K-2)
          this.state.lastPushedPrices[symbol] = {
            price: attestation.price_human,
            priceScaled: attestation.price,
            timestamp: Date.now(),
          };
          pushed.push(symbol);
        }
        saveKeeperState(this.config.stateFilePath, this.state);

        this.stats.oracleUpdates++;
        if (this.stats.oracleUpdates <= 3 || this.stats.oracleUpdates % 50 === 0) {
          console.log(
            `\n✅ Noeracle batch: ${pushed.length} assets round=${batch[0].round_id} (tx: ${result.txHash?.slice(0, 8)}...)`,
          );
        }

        // P1-4: refresh the vault NAV per asset now that the oracle prices
        // moved. Permissionless + non-fatal by design; spaced to be gentle
        // on the keeper account's sequence.
        for (const symbol of pushed) {
          await this.syncAssetPnl(symbol);
          await this.sleep(ORACLE_INTER_ASSET_DELAY_MS);
        }
      } else if (result.indeterminate) {
        console.log(`\n⚠️  Noeracle batch push indeterminate (may still land): ${result.txHash}`);
      } else {
        console.log(`\n⚠️  Noeracle batch push FAILED: ${result.error}`);
      }
    } catch (error) {
      console.error(`\n❌ Noeracle batch push ERROR:`, error instanceof Error ? error.message : error);
    }

    if (this.stats.oracleUpdates % 10 === 1) {
      console.log(`\n📡 Signed attestations from Noeracle → on-chain persistent storage`);
    }

    return pushed;
  }

  /**
   * K-2 publish-path defenses for one attestation. Returns true when the
   * price is safe to push; increments priceSkips + alerts when it is not.
   */
  private async passesPublishDefenses(symbol: string, attestation: Attestation): Promise<boolean> {
    const asset = this.config.assets.find(a => a.symbol === symbol)!;
    const priceHuman = attestation.price_human;
    const priceScaled = BigInt(attestation.price);

    // 1. Absolute sanity band (7-decimal fixed point)
    const minScaled = BigInt(Math.round(asset.minPrice * 1e7));
    const maxScaled = BigInt(Math.round(asset.maxPrice * 1e7));
    if (priceScaled < minScaled || priceScaled > maxScaled) {
      this.stats.priceSkips++;
      console.warn(`\n⚠️  ${symbol} $${priceHuman} outside sanity band [$${asset.minPrice}, $${asset.maxPrice}] — skipping push`);
      void sendAlert(
        'warn',
        `Price push skipped: ${symbol} outside sanity band`,
        `attestation $${priceHuman} not in [$${asset.minPrice}, $${asset.maxPrice}] (round ${attestation.round_id})`,
      );
      return false;
    }

    // 2. Per-asset jump bound vs the last PUSHED price (persisted — K-2).
    //    Waived when the last push is old enough that a large legitimate
    //    move is plausible (keeper downtime must not wedge the oracle);
    //    the band + reference checks still stand alone in that case.
    const lastPrice = this.currentPrices.get(symbol);
    if (lastPrice && lastPrice.price > 0) {
      const changePercent = (Math.abs(priceHuman - lastPrice.price) / lastPrice.price) * 100;
      if (changePercent > asset.maxMovePct) {
        const lastPushAge = Date.now() - lastPrice.timestamp;
        if (lastPushAge <= this.jumpBoundWindowMs()) {
          this.stats.priceSkips++;
          console.warn(`\n⚠️  ${symbol} moved ${changePercent.toFixed(1)}% ($${lastPrice.price} → $${priceHuman}) — skipping (> ${asset.maxMovePct}% per-push bound)`);
          void sendAlert(
            'warn',
            `Price push skipped: ${symbol} jump bound tripped`,
            `$${lastPrice.price} → $${priceHuman} (${changePercent.toFixed(1)}% > ${asset.maxMovePct}%). Repeated trips = bad upstream or real crash — check manually.`,
          );
          return false;
        }
        console.warn(`\n⚠️  ${symbol} moved ${changePercent.toFixed(1)}% but last push is ${Math.round(lastPushAge / 1000)}s old — jump bound waived (band + reference checks still apply)`);
      }
    }

    // 3. Independent reference ticker (availability over paranoia)
    const reference = await getReferencePrice(this.config.referenceTickerUrl, symbol);
    if (reference !== null) {
      const divergencePct = (Math.abs(priceHuman - reference) / reference) * 100;
      if (divergencePct > this.config.referenceDivergencePct) {
        this.stats.priceSkips++;
        console.warn(`\n⚠️  ${symbol} attestation $${priceHuman} diverges ${divergencePct.toFixed(1)}% from reference $${reference} — skipping push`);
        void sendAlert(
          'warn',
          `Price push skipped: ${symbol} diverges from independent reference`,
          `attestation $${priceHuman} vs reference $${reference} (${divergencePct.toFixed(1)}% > ${this.config.referenceDivergencePct}%)`,
        );
        return false;
      }
    } else {
      console.warn(`\n⚠️  ${symbol}: independent reference unreachable — pushing without cross-check`);
    }

    // 4. Stork secondary oracle (T3-D1). Fail-open when absent, stale, or
    //    unreachable — the system must run without it — but an AVAILABLE
    //    and strongly-divergent Stork blocks this asset's push: two
    //    independent oracles disagreeing is a compromise signal, not noise.
    //    Persistent disagreement drives the market stale (#30) for the
    //    asset: opens halt, closes keep working — the safe failure mode.
    const stork = getStorkPrice(symbol, this.config.storkMaxAgeMs);
    if (stork !== null) {
      const storkDivergencePct = (Math.abs(priceHuman - stork) / stork) * 100;
      if (storkDivergencePct > this.config.storkMaxDivergencePct) {
        this.stats.priceSkips++;
        console.warn(`\n🛑 ${symbol} attestation $${priceHuman} diverges ${storkDivergencePct.toFixed(2)}% from Stork $${stork} — skipping push`);
        void sendAlert(
          'critical',
          `DUAL-SOURCE DISAGREEMENT: ${symbol} Noeracle vs Stork`,
          `attestation $${priceHuman} vs Stork $${stork} (${storkDivergencePct.toFixed(2)}% > ${this.config.storkMaxDivergencePct}%). One of the two feeds is wrong — investigate before unblocking.`,
        );
        return false;
      }
    }

    return true;
  }

  /** Window inside which the per-asset jump bound is enforced. */
  private jumpBoundWindowMs(): number {
    return Math.max(10 * 60 * 1000, 5 * this.config.oracleUpdateIntervalMs);
  }

  /**
   * P1-4: permissionless NAV freshener — after a price push, ask the market
   * to recompute this asset's open trader PnL and sync it to the vault so
   * NOE pricing tracks the market between trades. Never fatal.
   */
  private async syncAssetPnl(symbol: string): Promise<void> {
    try {
      const result = await this.stellar.syncAssetPnl(symbol);
      if (result.success) {
        this.stats.syncPnlPushes++;
      } else if (!result.indeterminate) {
        this.logThrottled(`sync-pnl-${symbol}`, `⚠️  sync_asset_pnl(${symbol}) failed (non-fatal): ${result.error}`);
      }
    } catch (error) {
      this.logThrottled(
        `sync-pnl-${symbol}`,
        `⚠️  sync_asset_pnl(${symbol}) error (non-fatal): ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Lazy-init the Noeracle client.
   *
   * The SDK is ESM-only, so we load it via dynamic `import()` to stay
   * compatible with the keeper's CommonJS compile target. One client is
   * reused for the lifetime of the bot.
   */
  private async getNoeracle(): Promise<NoeracleClient> {
    if (!this.noeracleClient) {
      const { Noeracle } = await import('@noeracle/sdk');
      this.noeracleClient = new Noeracle({ network: this.config.network });
    }
    return this.noeracleClient;
  }

  /**
   * Fetch the latest signed attestation set (one round, all assets) from
   * the Noeracle attestation service. The SDK's fetchLatest takes no
   * AbortSignal, so the call is raced against a 10s timeout (K-1) — a hung
   * upstream fetch must never freeze the keeper loop.
   */
  private async fetchNoeracleFresh(): Promise<Awaited<ReturnType<NoeracleClient['fetchLatest']>>> {
    const noeracle = await this.getNoeracle();
    const pairs = this.config.assets.map(a => `${a.symbol}/USD`);
    return withTimeout(noeracle.fetchLatest(pairs), NOERACLE_FETCH_TIMEOUT_MS, 'Noeracle fetchLatest');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Market Snapshot (K-4)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Fetch all positions + orders ONCE per cycle. Distinguishes errored
   * reads from empty markets: on failure returns null (scans are skipped),
   * counts the failure streak, alerts at the threshold, and backs off —
   * the keeper must never conclude "nothing to liquidate" from an error.
   */
  private async buildSnapshot(): Promise<CycleSnapshot | null> {
    try {
      const positionIds = await this.stellar.getAllPositionIds();
      const orderIds = await this.stellar.getAllOrderIds();

      const positions: Position[] = [];
      const orders: Order[] = [];
      let entityReadErrors = 0;

      for (const id of positionIds) {
        try {
          const position = await this.stellar.getPosition(id);
          if (position) positions.push(position);
        } catch {
          entityReadErrors++;
        }
      }
      for (const id of orderIds) {
        try {
          const order = await this.stellar.getOrder(id);
          if (order) orders.push(order);
        } catch {
          entityReadErrors++;
        }
      }

      const attempted = positionIds.length + orderIds.length;
      if (attempted > 0 && entityReadErrors >= attempted) {
        throw new Error(`all ${attempted} entity reads failed`);
      }
      if (entityReadErrors > 0) {
        console.warn(`\n⚠️  Snapshot: ${entityReadErrors}/${attempted} entity reads failed — proceeding with partial snapshot`);
      }

      this.consecutiveReadFailures = 0;
      this.pruneEntityCaches(orders);
      return { positions, orders };
    } catch (error) {
      this.consecutiveReadFailures++;
      this.stats.readFailures++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ Market snapshot read failed (${this.consecutiveReadFailures} consecutive): ${message}`);

      if (this.consecutiveReadFailures === READ_FAILURE_ALERT_THRESHOLD) {
        void sendAlert(
          'critical',
          'Keeper cannot read market state',
          `${this.consecutiveReadFailures} consecutive snapshot failures — liquidation & order scanning is blind. Latest: ${message}`,
        );
      }
      if (this.consecutiveReadFailures >= READ_FAILURE_ALERT_THRESHOLD) {
        await this.sleep(READ_FAILURE_BACKOFF_MS);
      }
      return null;
    }
  }

  /** Drop per-order bookkeeping for orders that left the on-chain index. */
  private pruneEntityCaches(orders: Order[]): void {
    if (this.orphanedOrderIds.size === 0) return;
    const live = new Set(orders.map(o => o.id.toString()));
    for (const key of this.orphanedOrderIds) {
      if (!live.has(key)) this.orphanedOrderIds.delete(key);
    }
  }

  /** Local 7-decimal price map from the keeper's own pushed prices. */
  private localPriceMap(): Map<string, bigint> {
    const prices = new Map<string, bigint>();
    for (const [symbol, data] of this.currentPrices) {
      prices.set(symbol, data.priceScaled);
    }
    return prices;
  }

  /**
   * L0-9 interim two-strike confirmation: pre-Batch-1 the contract cannot
   * confirm liquidations on a smoothed mark (#86), so the keeper requires
   * `triggerConfirmReads` CONSECUTIVE liquidatable reads (~one poll
   * interval apart) before firing — a one-round oracle spike that
   * mean-reverts within a cycle never liquidates anyone. Bankrupt
   * positions (local equity ≤ 0) never wait: delaying bad debt costs LPs.
   * Returns true when the liquidation may fire now.
   */
  private confirmStrike(key: string, bankrupt: boolean): boolean {
    if (bankrupt || this.config.triggerConfirmReads <= 1) {
      this.liqStrikes.delete(key);
      return true;
    }
    const strikes = (this.liqStrikes.get(key) ?? 0) + 1;
    if (strikes >= this.config.triggerConfirmReads) {
      this.liqStrikes.delete(key);
      return true;
    }
    this.liqStrikes.set(key, strikes);
    return false;
  }

  /**
   * L0-9 spike flag — ALERT ONLY, pushes are never blocked here (the K-2
   * jump bound handles garbage). Surfaces the single-round manipulation
   * window for a human while the interim two-strike holds the line.
   * Throttled to one alert per symbol per 5 minutes.
   */
  private alertSpike(symbol: string, from: number, to: number, deltaPct: number): void {
    const last = this.spikeAlertAt.get(symbol) ?? 0;
    if (Date.now() - last < 5 * 60 * 1000) return;
    this.spikeAlertAt.set(symbol, Date.now());
    console.warn(`\n⚡ ${symbol} moved ${deltaPct.toFixed(2)}% in one push ($${from} → $${to})`);
    void sendAlert(
      'warn',
      `Price spike: ${symbol} ${deltaPct.toFixed(2)}% in one round`,
      `$${from} → $${to} between consecutive pushes (> ${this.config.spikeAlertPct}%). ` +
        `Single-round spikes are the L0-9 manipulation window — verify against reference feeds.`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Liquidations
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check isolated positions for liquidation (P2-9).
   *
   * `is_liquidatable` no longer exists on-chain. Pipeline per position:
   *  1. LOCAL prefilter: margin = collateral + pnl (mirrors contract math,
   *     funding buffered — see health.ts) below 2× maintenance margin, or
   *     the stored liquidation price is crossed. Free (no RPC).
   *  2. Simulate the real `liquidate` call — the simulation re-runs the
   *     exact on-chain check including funding. #50 = healthy, skip.
   *  3. Submit only when the simulation succeeds.
   * A periodic full sweep skips step 1 to bound local-math drift.
   */
  private async checkLiquidations(snapshot: CycleSnapshot, fullSweep: boolean): Promise<void> {
    const prices = this.localPriceMap();

    // Drop strike counters for positions/accounts no longer in the snapshot.
    const liveKeys = new Set<string>();
    for (const p of snapshot.positions) {
      liveKeys.add(p.margin_mode === 1 ? `cross:${p.trader}` : `iso:${p.id}`);
    }
    for (const key of this.liqStrikes.keys()) {
      if (!liveKeys.has(key)) this.liqStrikes.delete(key);
    }

    for (const position of snapshot.positions) {
      // Cross-margin positions use account-level liquidation
      if (position.margin_mode === 1) continue;

      try {
        const price = prices.get(position.asset);
        const candidate =
          fullSweep ||
          price === undefined || // no local price → let the simulation decide
          isLiquidationCandidate(position, price, await this.prefilterMmBps(position.asset));
        if (!candidate) {
          this.liqStrikes.delete(`iso:${position.id}`);
          continue;
        }

        const sim = await this.stellar.simulateLiquidate(position.id);
        if (!sim.ok) {
          const code = extractContractErrorCode(sim.error);
          // 50 healthy / 20 already gone / 83 within the partial-liq grace
          // window (L0-5) / 90 full-freeze pause (L0-15) / 86 confirmation
          // pending (L0-9) — all expected, no alert.
          if (code === 50 || code === 20) this.liqStrikes.delete(`iso:${position.id}`);
          if (code === 50 || code === 20 || code === 83 || code === 90 || code === 86) continue;
          this.logThrottled(
            `liq-sim-${position.id}`,
            `⚠️  Liquidation preflight for position ${position.id} rejected: ${sim.error}`,
          );
          continue;
        }

        // L0-9 interim: require consecutive liquidatable reads before
        // firing; a locally-bankrupt position (equity ≤ 0) never waits.
        const bankrupt = price !== undefined && positionMargin(position, price) <= 0n;
        if (!this.confirmStrike(`iso:${position.id}`, bankrupt)) {
          console.log(
            `\n⏳ Position ${position.id} liquidatable — confirming next cycle (L0-9 two-strike)`,
          );
          continue;
        }

        console.log(`\n⚠️  Position ${position.id} is liquidatable (local margin check + simulation)`);
        await this.executeLiquidation(position);
      } catch (error) {
        // Transport failure on the preflight — next cycle retries.
        this.logThrottled(
          `liq-err-${position.id}`,
          `⚠️  Liquidation check error for position ${position.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  /**
   * Execute a liquidation
   */
  private async executeLiquidation(position: Position): Promise<void> {
    console.log(`   Executing liquidation for position ${position.id}...`);

    // L0-19: settle on a relayed fresh mark when a round is available; any
    // router-side failure falls back to the direct call — a liquidation is
    // never lost to the router path.
    let via: 'router' | 'direct' = 'direct';
    let result: ExecutionResult | null = null;
    if (this.routerAvailable('liquidate_with_price')) {
      const round = await this.getExecutionRound(position.asset);
      if (round) {
        result = await this.stellar.liquidateViaRouter(position.id, position.asset, round);
        via = 'router';
        if (!result.success && !result.indeterminate) {
          if (isMissingContractFunction(result.error ?? '')) {
            this.routerFnSupported.set('liquidate_with_price', false);
          }
          result = null;
          via = 'direct';
        }
      }
    }
    if (result === null) result = await this.stellar.liquidate(position.id);

    if (result.success) {
      if (via === 'router') this.stats.routerExecutions++;
      this.stats.liquidationsExecuted++;
      if (result.reward) {
        this.stats.totalRewardsEarned += result.reward;
      }
      console.log(`   ✅ Liquidation successful!`);
      console.log(`   Transaction: ${result.txHash}`);
      if (result.reward) {
        console.log(`   Reward: ${this.formatAmount(result.reward)} USDC`);
      }
    } else if (result.indeterminate) {
      console.log(`   ⏳ Liquidation indeterminate (tx ${result.txHash?.slice(0, 8)}... may still land) — will re-check next cycle`);
    } else {
      console.log(`   ❌ Liquidation failed: ${result.error}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Cross-Margin Liquidations
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check cross-margin accounts for liquidation (K-4).
   *
   * Cross traders come from the shared snapshot (no re-enumeration), and
   * the expensive attempt-and-let-#78-reject preflight is gated behind a
   * LOCAL equity prefilter: equity = pool balance (cached 60s) + Σ
   * collateral + Σ pnl at the keeper's own prices, candidate only when
   * below buffered maintenance margin. The submit path's built-in
   * simulation remains the on-chain truth.
   */
  private async checkCrossMarginLiquidations(snapshot: CycleSnapshot, fullSweep: boolean): Promise<void> {
    const crossByTrader = new Map<string, Position[]>();
    for (const position of snapshot.positions) {
      if (position.margin_mode !== 1) continue;
      const list = crossByTrader.get(position.trader);
      if (list) list.push(position);
      else crossByTrader.set(position.trader, [position]);
    }
    if (crossByTrader.size === 0) return;

    // Drop cached balances for traders with no cross positions anymore
    for (const trader of this.crossBalanceCache.keys()) {
      if (!crossByTrader.has(trader)) this.crossBalanceCache.delete(trader);
    }

    const prices = this.localPriceMap();

    for (const [trader, positions] of crossByTrader) {
      try {
        let candidate = fullSweep;
        if (!candidate) {
          const balance = await this.getCrossBalanceCached(trader);
          if (balance === undefined) continue; // balance unreadable → RPC issue; full sweep covers it
          // L0-12: per-leg mm from the ladder (resolved up front — the
          // health resolver itself must stay synchronous and pure).
          const mmByAsset = new Map<string, bigint>();
          for (const position of positions) {
            if (!mmByAsset.has(position.asset)) {
              mmByAsset.set(position.asset, await this.prefilterMmBps(position.asset));
            }
          }
          candidate = isCrossLiquidationCandidate(
            balance,
            positions,
            prices,
            (p) => mmByAsset.get(p.asset) ?? DEFAULT_MAINTENANCE_MARGIN_BPS,
          );
        }
        if (!candidate) {
          this.liqStrikes.delete(`cross:${trader}`);
          continue;
        }

        // L0-9 interim two-strike (bankrupt accounts skip the wait; a null
        // equity — missing price — must NOT count as bankrupt).
        const equityBalance = await this.getCrossBalanceCached(trader);
        const equity =
          equityBalance === undefined ? null : crossEquity(equityBalance, positions, prices);
        const bankrupt = equity !== null && equity <= 0n;
        if (!this.confirmStrike(`cross:${trader}`, bankrupt)) {
          console.log(
            `\n⏳ Cross account ${trader.slice(0, 8)}... liquidatable — confirming next cycle (L0-9 two-strike)`,
          );
          continue;
        }

        // Preflight stays inside the write path: the pre-submit simulation
        // rejects healthy accounts with #78 before any fee is spent.
        // L0-19: prefer the router relay when EVERY leg's asset has a fresh
        // round (the account settles on relayed marks); business rejections
        // stand, router-specific failures fall back to the direct call.
        let result: ExecutionResult | null = null;
        let via: 'router' | 'direct' = 'direct';
        if (this.routerAvailable('liquidate_cross_with_prices')) {
          const rounds: Array<{ asset: string; round: RouterRound }> = [];
          for (const asset of new Set(positions.map(p => p.asset))) {
            const round = await this.getExecutionRound(asset);
            if (!round) {
              rounds.length = 0;
              break;
            }
            rounds.push({ asset, round });
          }
          if (rounds.length > 0) {
            result = await this.stellar.liquidateCrossViaRouter(trader, rounds);
            via = 'router';
            if (!result.success && !result.indeterminate) {
              if (isMissingContractFunction(result.error ?? '')) {
                this.routerFnSupported.set('liquidate_cross_with_prices', false);
              }
              const code = extractContractErrorCode(result.error ?? '');
              if (code !== 78 && code !== 83 && code !== 90 && code !== 86) {
                result = null; // router-specific failure → direct fallback
                via = 'direct';
              }
            }
          }
        }
        if (result === null) {
          result = await this.stellar.liquidateCrossAccount(trader);
          via = 'direct';
        }
        if (result.success) {
          if (via === 'router') this.stats.routerExecutions++;
          this.stats.liquidationsExecuted++;
          if (result.reward) this.stats.totalRewardsEarned += result.reward;
          console.log(`\n⚠️  Cross-margin account ${trader.slice(0, 8)}... liquidated!`);
          console.log(`   ✅ Reward: ${this.formatAmount(result.reward || BigInt(0))} USDC`);
        } else if (result.indeterminate) {
          console.log(`\n⏳ Cross liquidation for ${trader.slice(0, 8)}... indeterminate — re-checking next cycle`);
        } else {
          const code = extractContractErrorCode(result.error ?? '');
          // #78 healthy (prefilter was conservative), #83 inside the
          // account-scoped staged-liq grace window (L0-5), #90 full-freeze
          // pause (L0-15), #86 confirmation pending (L0-9) — all expected.
          if (code !== 78 && code !== 83 && code !== 90 && code !== 86) {
            this.logThrottled(
              `cross-liq-${trader}`,
              `⚠️  Cross liquidation attempt for ${trader.slice(0, 8)}... failed: ${result.error}`,
            );
          }
        }
      } catch (error) {
        this.logThrottled(
          `cross-err-${trader}`,
          `⚠️  Cross liquidation check error for ${trader.slice(0, 8)}...: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  /**
   * Prefilter mm_bps for an asset (L0-12 ladder parity). The keeper cannot
   * read RiskEpochTs (no view), so it cannot reproduce per-position
   * grandfathering — instead it uses max(ladder mm, legacy mm), which is
   * CONSERVATIVE for the prefilter: it can only over-trigger simulations
   * (the simulation is the on-chain truth), never miss a liquidatable
   * position under either regime. Legacy default on pre-L0-12 markets
   * (missing export), unconfigured assets, and read failures.
   */
  private async prefilterMmBps(asset: string): Promise<bigint> {
    if (this.riskLadderSupported === false) return DEFAULT_MAINTENANCE_MARGIN_BPS;
    const now = Date.now();
    const cached = this.assetMmBpsCache.get(asset);
    if (cached && now - cached.fetchedAt < ASSET_RISK_CACHE_MS) return cached.mmBps;

    let mmBps = DEFAULT_MAINTENANCE_MARGIN_BPS;
    try {
      const ladder = await this.stellar.getAssetRiskMmBps(asset);
      this.riskLadderSupported = true;
      if (ladder !== null && ladder > 0) {
        const ladderBps = BigInt(ladder);
        mmBps = ladderBps > DEFAULT_MAINTENANCE_MARGIN_BPS ? ladderBps : DEFAULT_MAINTENANCE_MARGIN_BPS;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isMissingContractFunction(message)) {
        this.riskLadderSupported = false; // pre-L0-12 market — legacy mm everywhere
      } else {
        this.logThrottled(`risk-${asset}`, `⚠️  get_asset_risk read failed for ${asset}: ${message}`);
        return cached?.mmBps ?? DEFAULT_MAINTENANCE_MARGIN_BPS; // stale beats blind, cache untouched
      }
    }
    this.assetMmBpsCache.set(asset, { mmBps, fetchedAt: now });
    return mmBps;
  }

  /** Cross pool balance with a 60s cache; stale value on read failure. */
  private async getCrossBalanceCached(trader: string): Promise<bigint | undefined> {
    const now = Date.now();
    const cached = this.crossBalanceCache.get(trader);
    if (cached && now - cached.fetchedAt < CROSS_BALANCE_CACHE_MS) return cached.balance;

    try {
      const balance = await this.stellar.getCrossMarginBalance(trader);
      this.crossBalanceCache.set(trader, { balance, fetchedAt: now });
      return balance;
    } catch (error) {
      this.logThrottled(
        `cross-bal-${trader}`,
        `⚠️  Cross balance read failed for ${trader.slice(0, 8)}...: ${error instanceof Error ? error.message : error}`,
      );
      return cached?.balance; // stale beats blind
    }
  }

  /**
   * L0-20 keeper duty: a factory-vault order that just executed (or was
   * cancelled by slippage) leaves the vault's full-NAV under-counted (an
   * executed order contributes 0 until its OrderVault mapping moves to the
   * created position; a cancel refund sits uncredited). reconcile_order is
   * permissionless — the keeper calls it right after its own execution.
   * Quiet no-op for non-factory orders, stacks without a factory id, and
   * pre-L0-20 factories (missing export → duty marks itself inert).
   */
  private async maybeReconcileFactoryOrder(orderId: bigint): Promise<void> {
    if (!this.config.vaultFactoryContractId || this.factoryReconcileSupported === false) return;

    let vaultId: number | null;
    try {
      vaultId = await this.stellar.getOrderVault(orderId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isMissingContractFunction(message)) {
        this.factoryReconcileSupported = false;
        if (!this.factoryReconcileUnsupportedLogged) {
          this.factoryReconcileUnsupportedLogged = true;
          console.log(
            '\nℹ️  Factory reconcile views not present on this deployment — reconcile duty disabled until the Batch-1 redeploy.',
          );
        }
      } else {
        this.logThrottled(`reconcile-read-${orderId}`, `⚠️  get_order_vault read failed for ${orderId}: ${message}`);
      }
      return;
    }
    this.factoryReconcileSupported = true;
    if (vaultId == null) return; // not a factory-vault order

    const result = await this.stellar.reconcileOrder(vaultId, orderId);
    if (result.success) {
      this.stats.ordersReconciled++;
      console.log(`   🔗 Factory order ${orderId} reconciled to vault ${vaultId}`);
    } else if (!result.indeterminate) {
      const code = extractContractErrorCode(result.error ?? '');
      // #3 InvalidParameter = order still Pending (stop→limit phase
      // transition) — reconcile applies only once it finalizes.
      if (code === 3) return;
      this.logThrottled(
        `reconcile-${orderId}`,
        `⚠️  reconcile_order failed for order ${orderId} (vault ${vaultId}): ${result.error}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Router Execution Path (L0-19)
  // ═══════════════════════════════════════════════════════════════════════

  /** True unless a probe proved the deployed router lacks this entry point. */
  private routerAvailable(fn: string): boolean {
    return !!this.config.routerContractId && this.routerFnSupported.get(fn) !== false;
  }

  /**
   * Signed round for one asset, freshest-first: cache ≤15s (already
   * fresher than the 30s publish cadence — no HTTP hop) → one fresh
   * Noeracle fetch under the existing timeout (refreshes every symbol's
   * cache) → cache ≤60s (the on-chain staleness bound) → null, and the
   * caller falls back to the DIRECT market call. Round sourcing must never
   * cost execution liveness.
   */
  private async getExecutionRound(symbol: string): Promise<RouterRound | null> {
    const now = Date.now();
    const cached = this.latestRounds.get(symbol);
    if (cached && now - cached.cachedAt <= ROUND_FRESH_FAST_PATH_MS) return cached.att;

    try {
      const fresh = await this.fetchNoeracleFresh();
      const fetchedAt = Date.now();
      for (const att of fresh.attestations) {
        const sym = att.asset.endsWith('/USD') ? att.asset.slice(0, -4) : att.asset;
        this.latestRounds.set(sym, { att, cachedAt: fetchedAt });
      }
    } catch (error) {
      this.logThrottled(
        'round-fetch',
        `⚠️  Noeracle round fetch for execution failed: ${error instanceof Error ? error.message : error}`,
      );
    }

    const fallback = this.latestRounds.get(symbol);
    if (fallback && Date.now() - fallback.cachedAt <= ROUND_MAX_AGE_MS) return fallback.att;
    return null;
  }

  /** healthchecks.io-style liveness ping after every completed cycle. */
  private pingHealthcheck(): void {
    if (!this.config.healthcheckUrl) return;
    fetch(this.config.healthcheckUrl).catch(() => {});
  }

  /**
   * #30 rescue (the core L0-19 fix): a strict-path entry execution that
   * fails PriceStale on the direct simulation is exactly what the router
   * relay repairs — verify-then-trade carries a fresh signed round in the
   * same tx. Returns true when the order was handled via the router.
   */
  private async tryRouterRescue(order: Order): Promise<boolean> {
    if (!this.routerAvailable('execute_with_price')) return false;
    const round = await this.getExecutionRound(order.asset);
    if (!round) return false;

    const sim = await this.stellar.simulateRouterCall('execute_with_price', order.id, order.asset, round);
    if (!sim.ok) {
      if (isMissingContractFunction(sim.error)) {
        this.routerFnSupported.set('execute_with_price', false);
      } else {
        this.classifyOrderSimRejection(order, sim.error);
      }
      return false;
    }

    console.log(
      `\n📋 Order ${order.id} triggered via router relay (${order.order_type} ${order.direction} ${order.asset})`,
    );
    console.log(`   Executing order ${order.id}...`);
    const result = await this.stellar.executeOrderViaRouter(order.id, order.asset, round);
    await this.handleOrderExecutionResult(order.id, order.order_type, result, 'router');
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ADL Manager (L0-1)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Advisory ADL phase (L0-1). The keeper is the RANKING authority only —
   * the on-chain #84/#85 gates are the consensus. Per asset with open
   * positions: mirror the trigger math locally (payable uPnL from the
   * snapshot at the keeper's own prices vs cached vault coverage) and
   * spend a check_adl_trigger simulation only when the mirror says the
   * flag should flip, the flag is already active, or the periodic full
   * sweep is due (shortfall auto-flips happen on-chain with no keeper
   * involvement — the sweep bounds their discovery latency). While the
   * flag is active: walk positive-pnl positions by adlRank desc through
   * adl_close (bounded per cycle), re-checking the trigger between
   * closes. Every activation / clear / execution fires the alert channel —
   * ADL is a five-alarm event. Against a pre-L0-1 market every probe
   * fails with "unknown export": the phase marks itself unsupported and
   * goes quiet until the next restart (the Batch-1 redeploy).
   */
  /** True once a probe proved the deployed market lacks the ADL entry points. */
  private adlDisabled(): boolean {
    return this.adlSupported === false;
  }

  private async manageAdl(snapshot: CycleSnapshot, fullSweep: boolean): Promise<void> {
    if (this.adlDisabled()) return;

    const prices = this.localPriceMap();
    const byAsset = new Map<string, Position[]>();
    for (const position of snapshot.positions) {
      const list = byAsset.get(position.asset);
      if (list) list.push(position);
      else byAsset.set(position.asset, [position]);
    }

    for (const [asset, positions] of byAsset) {
      if (this.adlDisabled()) return; // flipped mid-loop by a probe
      const price = prices.get(asset);
      if (price === undefined || price <= 0n) continue;

      try {
        const active = this.adlActive.get(asset) ?? false;
        const probeDue =
          fullSweep ||
          active ||
          Date.now() - (this.adlLastProbeAt.get(asset) ?? 0) >= this.config.adlCheckIntervalMs;
        if (!probeDue) continue;

        if (!active && !fullSweep) {
          // Local mirror: only spend the probe when it could matter.
          const payable = assetPayableUpnl(positions, price);
          if (payable === 0n) continue; // nothing payable → ADL cannot be needed
          const coverage = await this.getVaultCoverageCached();
          if (coverage !== undefined) {
            const decision = adlFlagDecision(
              payable,
              coverage,
              false,
              BigInt(this.config.adlTriggerRatioBps),
              BigInt(this.config.adlClearRatioBps),
            );
            if (decision === 'hold') continue;
          }
          // coverage unreadable or mirror says activate → probe on-chain truth
        }

        await this.probeAndDriveAdl(asset, positions, price);
      } catch (error) {
        this.logThrottled(
          `adl-${asset}`,
          `⚠️  ADL phase error for ${asset}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  /**
   * Probe the on-chain flag (check_adl_trigger simulation — its retval is
   * the flag AFTER the call would run), reconcile it on-chain when it
   * would change, and while active walk ranked winners through adl_close.
   */
  private async probeAndDriveAdl(asset: string, positions: Position[], price: bigint): Promise<void> {
    this.adlLastProbeAt.set(asset, Date.now());

    const sim = await this.stellar.simulateCheckAdlTrigger(asset);
    if (!sim.ok) {
      if (isMissingContractFunction(sim.error)) {
        this.adlSupported = false;
        if (!this.adlUnsupportedLogged) {
          this.adlUnsupportedLogged = true;
          console.log(
            '\nℹ️  ADL entry points not present on this market deployment — ADL phase disabled until the Batch-1 redeploy.',
          );
        }
      } else {
        this.logThrottled(
          `adl-sim-${asset}`,
          `⚠️  check_adl_trigger preflight failed for ${asset}: ${sim.error}`,
        );
      }
      return;
    }
    this.adlSupported = true;

    const simFlag = sim.retval === true;
    const cached = this.adlActive.get(asset);

    // Reconcile: submit only when the call would actually change the
    // stored on-chain flag — a same-state submit is a wasted fee.
    if (cached === undefined || simFlag !== cached) {
      let onChain: boolean;
      try {
        onChain = await this.stellar.isAdlActive(asset);
      } catch (error) {
        this.logThrottled(
          `adl-read-${asset}`,
          `⚠️  is_adl_active read failed for ${asset}: ${error instanceof Error ? error.message : error}`,
        );
        return;
      }
      if (simFlag !== onChain) {
        const result = await this.stellar.checkAdlTrigger(asset);
        if (!result.success) {
          if (!result.indeterminate) {
            this.logThrottled(
              `adl-flip-${asset}`,
              `⚠️  check_adl_trigger submit failed for ${asset}: ${result.error}`,
            );
          }
          return; // cache untouched — re-probed next cycle
        }
        this.stats.adlFlagFlips++;
        if (simFlag) {
          console.log(`\n🚨 ADL ACTIVATED for ${asset} — auto-deleveraging ranked winners`);
          await sendAlert(
            'critical',
            `ADL activated for ${asset}`,
            'Pool coverage fell under the trigger ratio — the keeper is force-realizing ranked winners.',
          );
        } else {
          console.log(`\n✅ ADL cleared for ${asset}`);
          await sendAlert('warn', `ADL cleared for ${asset}`, 'Pool coverage recovered above the clear ratio.');
        }
      }
      this.adlActive.set(asset, simFlag);
    }

    if (!this.adlActive.get(asset)) return;

    // The walk: ranked winners, bounded per cycle, re-check between closes.
    const ranked = rankAdlCandidates(positions, price);
    let closes = 0;
    for (const candidate of ranked) {
      if (closes >= this.config.adlMaxClosesPerCycle) break;

      // L0-19: forced realizations settle on a relayed fresh mark when
      // available; business rejections (#84/#85/#20) stand either way,
      // router-specific failures fall back to the direct call.
      let result: ExecutionResult | null = null;
      let via: 'router' | 'direct' = 'direct';
      if (this.routerAvailable('adl_with_price')) {
        const round = await this.getExecutionRound(asset);
        if (round) {
          result = await this.stellar.adlCloseViaRouter(candidate.position.id, asset, round);
          via = 'router';
          if (!result.success && !result.indeterminate) {
            if (isMissingContractFunction(result.error ?? '')) {
              this.routerFnSupported.set('adl_with_price', false);
            }
            const code = extractContractErrorCode(result.error ?? '');
            if (code !== 84 && code !== 85 && code !== 20) {
              result = null; // router-specific failure → direct fallback
              via = 'direct';
            }
          }
        }
      }
      if (result === null) result = await this.stellar.adlClose(candidate.position.id);
      if (result.success) {
        if (via === 'router') this.stats.routerExecutions++;
        closes++;
        this.stats.adlCloses++;
        console.log(
          `\n⚡ ADL closed position ${candidate.position.id} (${asset} ${candidate.position.direction}, score ${candidate.score})`,
        );
        await sendAlert(
          'critical',
          `ADL executed on ${asset}`,
          `Position ${candidate.position.id} force-realized (rank score ${candidate.score}).`,
        );

        // Re-check the trigger between closes; clear on-chain and stop
        // as soon as coverage has recovered.
        const recheck = await this.stellar.simulateCheckAdlTrigger(asset);
        if (recheck.ok && recheck.retval === false) {
          const clear = await this.stellar.checkAdlTrigger(asset);
          if (clear.success) {
            this.stats.adlFlagFlips++;
            this.adlActive.set(asset, false);
            console.log(`\n✅ ADL cleared for ${asset} after ${closes} close(s)`);
            await sendAlert(
              'warn',
              `ADL cleared for ${asset}`,
              `Coverage recovered after ${closes} ADL close(s).`,
            );
          }
          break;
        }
      } else if (result.indeterminate) {
        break; // may still land — never stack closes on a stale ranking
      } else {
        const code = extractContractErrorCode(result.error ?? '');
        if (code === 84) {
          this.adlActive.set(asset, false); // flag off on-chain — cache was stale
          break;
        }
        if (code === 85 || code === 20) continue; // no longer a winner / gone — next candidate
        this.logThrottled(
          `adl-close-${candidate.position.id}`,
          `⚠️  adl_close failed for position ${candidate.position.id}: ${result.error}`,
        );
      }
    }
  }

  /**
   * Vault coverage (buffer + LP USDC) with a 30s cache; stale beats blind,
   * undefined only when never readable (the mirror then defers to probes).
   */
  private async getVaultCoverageCached(): Promise<bigint | undefined> {
    const now = Date.now();
    if (this.vaultCoverageCache && now - this.vaultCoverageCache.fetchedAt < VAULT_COVERAGE_CACHE_MS) {
      return this.vaultCoverageCache.value;
    }
    try {
      const value = await this.stellar.getVaultCoverage();
      this.vaultCoverageCache = { value, fetchedAt: now };
      return value;
    } catch (error) {
      this.logThrottled(
        'adl-coverage',
        `⚠️  Vault coverage read failed: ${error instanceof Error ? error.message : error}`,
      );
      return this.vaultCoverageCache?.value;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Trailing Stop Peak Updates
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Update trailing stop peak prices (K-5). The contract returns Ok(false)
   * for no-ops but a submitted no-op still costs a fee and ~6-10s — so
   * SIMULATE first and submit only when the simulated return value is
   * true. Runs only in cycles that actually pushed an oracle price.
   */
  private async updateTrailingStopPeaks(snapshot: CycleSnapshot): Promise<void> {
    const trailingOrders = snapshot.orders.filter(
      o => o.order_type === 'TrailingStop' && o.status === 'Pending',
    );

    for (const order of trailingOrders) {
      try {
        const sim = await this.stellar.simulateUpdateTrailingPeak(order.id);
        if (!sim.ok) {
          // #30 stale / #81 deviation etc — nothing to do this tick
          this.logThrottled(
            `peak-sim-${order.id}`,
            `⚠️  Trailing peak preflight for order ${order.id} rejected: ${sim.error}`,
          );
          continue;
        }
        if (sim.retval !== true) continue; // no peak movement — do not pay for a no-op

        const result = await this.stellar.updateTrailingPeak(order.id);
        if (result.success) {
          this.stats.trailingPeakUpdates++;
        }
      } catch (error) {
        this.logThrottled(
          `peak-err-${order.id}`,
          `⚠️  Trailing peak update error for order ${order.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Order Execution
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check pending orders for execution (P2-10). `should_execute_order` was
   * removed on-chain — preview by SIMULATING the real `execute_order` and
   * submit only when the simulation succeeds. Business rejections coming
   * back from the simulation (#62 not triggered, #81 deviation, #82 OI
   * cap, #80 cross-order) are non-retryable for this tick: skip quietly.
   */
  private async checkOrders(snapshot: CycleSnapshot): Promise<void> {
    const pendingOrders = snapshot.orders.filter(o => o.status === 'Pending');
    const triggeredIds = new Set<string>();

    for (const order of pendingOrders) {
      try {
        const sim = await this.stellar.simulateExecuteOrder(order.id);
        if (!sim.ok) {
          // L0-19: strict-path staleness (#30) is exactly what the router
          // relay fixes — try execute_with_price before giving up the tick.
          if (extractContractErrorCode(sim.error) === 30 && (await this.tryRouterRescue(order))) {
            triggeredIds.add(order.id.toString());
            continue;
          }
          this.classifyOrderSimRejection(order, sim.error);
          continue;
        }

        triggeredIds.add(order.id.toString());
        console.log(`\n📋 Order ${order.id} triggered! (${order.order_type} ${order.direction} ${order.asset})`);
        await this.executeOrder(order.id, order.order_type, order.asset);
      } catch (error) {
        this.logThrottled(
          `order-err-${order.id}`,
          `⚠️  Order check error for ${order.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    // L0-19 dead-man: a triggered order still pending after N cycles means
    // executions are not landing (RPC dead, fee starvation, sequence
    // pinning) — the silent single-keeper failure mode. Runs even on an
    // empty book so counters for gone orders are pruned.
    const stuck = trackTriggeredStuck(
      this.triggeredStuckCounts,
      triggeredIds,
      this.config.triggeredStuckAlertCycles,
    );
    if (stuck.length > 0) {
      await sendAlert(
        'critical',
        'Triggered orders stuck pending',
        `Orders ${stuck.join(', ')} triggered for ${this.config.triggeredStuckAlertCycles}+ consecutive cycles without executing — check RPC health, fees, and keeper sequence.`,
      );
    }
  }

  /** Route an execute_order simulation rejection to the right (quiet) bucket. */
  private classifyOrderSimRejection(order: Order, error: string): void {
    const code = extractContractErrorCode(error);

    // Not triggered yet — the normal case for a resting order.
    if (code === 62) return;

    // Position already closed (manually or liquidated): orphaned SL/TP.
    if (code === 20 || code === 60) {
      const key = order.id.toString();
      if (!this.orphanedOrderIds.has(key)) {
        this.orphanedOrderIds.add(key);
        this.stats.ordersSkippedOrphaned++;
        console.log(`\n⚠️  Order ${order.id} skipped: position already closed — this ${order.order_type} order is orphaned and will be ignored.`);
      }
      return;
    }

    // Business rejections for this tick: #80 cross-order unsupported
    // (PRE-Batch-1 markets only — the L1-1 market accepts cross triggers),
    // #81 price deviation too high, #82 OI cap exceeded.
    // Also #61 (already executed elsewhere), #30 (price stale), and the
    // Batch-1 codes — #87 acceptable-price bound (L0-10), #89 skew cap
    // (L0-14), #90 frozen (L0-15), #91 nets-to-zero (L1-3), #92 asset
    // halted (L1-24).
    if (
      code === 80 || code === 81 || code === 82 || code === 61 || code === 30 ||
      code === 87 || code === 89 || code === 90 || code === 91 || code === 92
    ) {
      this.logThrottled(
        `order-biz-${order.id}-${code}`,
        `ℹ️  Order ${order.id} not executable this tick (contract #${code})`,
      );
      return;
    }

    this.logThrottled(`order-sim-${order.id}`, `⚠️  Order ${order.id} preflight rejected: ${error}`);
  }

  /**
   * Execute a triggered order — via the router relay when a fresh signed
   * round is available (settles on the relayed mark), falling back to the
   * direct market call otherwise (L0-19: liveness before freshness).
   */
  private async executeOrder(orderId: bigint, orderType: string, asset: string): Promise<void> {
    console.log(`   Executing order ${orderId}...`);

    let via: 'router' | 'direct' = 'direct';
    let result: ExecutionResult | null = null;
    if (this.routerAvailable('execute_with_price')) {
      const round = await this.getExecutionRound(asset);
      if (round) {
        const sim = await this.stellar.simulateRouterCall('execute_with_price', orderId, asset, round);
        if (sim.ok) {
          result = await this.stellar.executeOrderViaRouter(orderId, asset, round);
          via = 'router';
        } else if (isMissingContractFunction(sim.error)) {
          this.routerFnSupported.set('execute_with_price', false);
        }
        // Any other router-sim rejection → fall through to the direct path.
      }
    }
    if (result === null) result = await this.stellar.executeOrder(orderId);

    await this.handleOrderExecutionResult(orderId, orderType, result, via);
  }

  /** Shared outcome handling for direct and router order executions. */
  private async handleOrderExecutionResult(
    orderId: bigint,
    orderType: string,
    result: ExecutionResult,
    via: 'router' | 'direct',
  ): Promise<void> {
    if (result.success && via === 'router') this.stats.routerExecutions++;
    if (result.success) {
      // Check if order was cancelled due to slippage or StopLimit phase transition (reward = 0)
      if (result.reward === BigInt(0)) {
        if (orderType === 'StopLimit') {
          console.log(`   🔄 StopLimit order ${orderId} stop triggered → limit phase active`);
        } else {
          this.stats.ordersCancelledSlippage++;
          console.log(`   ⚠️  Order ${orderId} cancelled due to slippage exceeded (collateral refunded)`);
          // L0-20: a cancelled factory-vault order left its refund sitting
          // uncredited at the factory — reconcile books it.
          await this.maybeReconcileFactoryOrder(orderId);
        }
      } else {
        this.stats.ordersExecuted++;
        this.stats.totalRewardsEarned += result.reward!;
        console.log(`   ✅ Order executed successfully!`);
        console.log(`   Transaction: ${result.txHash}`);
        console.log(`   Keeper fee: ${this.formatAmount(result.reward!)} USDC`);
        // L0-20: an executed factory-vault order contributes 0 to the
        // vault's full-NAV until reconciled to its created position.
        await this.maybeReconcileFactoryOrder(orderId);
      }
    } else if (result.indeterminate) {
      console.log(`   ⏳ Order execution indeterminate (tx ${result.txHash?.slice(0, 8)}... may still land) — will re-check next cycle`);
    } else {
      // Handle PositionNotFound (Error #20) for SL/TP orders
      // This happens when the position was already closed (manually, liquidated, or by another SL/TP)
      // The order is orphaned but harmless - just skip it
      if (result.error?.includes('PositionNotFound') || result.error?.includes('#20')) {
        this.stats.ordersSkippedOrphaned++;
        console.log(`   ⚠️  Order ${orderId} skipped: Position already closed (manually or liquidated)`);
        console.log(`      This ${orderType} order is now orphaned and will be ignored.`);
      } else {
        console.log(`   ❌ Order execution failed: ${result.error}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Funding Rate
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Apply the funding rate on the contract's clock (K-7 tri-state).
   *
   * There is no on-chain view for the last funding time, so the keeper
   * tracks the last SUBMIT that landed (persisted) and parses #55
   * (FundingIntervalNotElapsed) as 'not-due' — which is a healthy answer,
   * NOT a failure. Only repeated real failures alert; a real failure
   * retries in 60s instead of silently waiting another full hour.
   */
  /**
   * Periodic (default 6h) proactive TTL extension of the long-lived
   * contracts the keeper doesn't otherwise write to (market/vault/router/
   * shim) + a keeper-wallet XLM funding alarm (P3-9/P3-10). An archived
   * instance is a dead exchange; an empty keeper wallet freezes prices AND
   * liquidations. Best-effort and non-fatal.
   */
  private async maybeBumpTtls(now: number): Promise<void> {
    if (now < this.nextTtlBumpAt) return;
    this.nextTtlBumpAt = now + this.config.ttlBumpIntervalMs;

    // Wallet-funding alarm first — cheap and the most urgent signal.
    const xlm = await this.stellar.getXlmBalance();
    if (xlm !== null && xlm < this.config.minKeeperXlm) {
      void sendAlert(
        'critical',
        'Keeper wallet low on XLM',
        `balance=${xlm.toFixed(2)} XLM < min ${this.config.minKeeperXlm} — refill ${this.stellar.publicKey}`,
      );
    }

    // Extend instance+code TTLs. Failures are logged, never fatal.
    const targets: Array<[string, string]> = [
      ['market', this.config.marketContractId],
      ['vault', this.config.vaultContractId],
      ['router', this.config.routerContractId],
      ['shim', this.config.shimContractId],
    ];
    const bumped: string[] = [];
    for (const [name, id] of targets) {
      if (!id) continue;
      const ok = await this.stellar.bumpContractTtl(id, this.config.ttlExtendToLedgers);
      if (ok) bumped.push(name);
      else this.logThrottled(`ttl:${name}`, `⚠️  TTL bump failed for ${name} (${id.slice(0, 8)}…)`);
    }
    if (bumped.length > 0) {
      console.log(`\n🔁 Extended TTL: ${bumped.join(', ')}`);
    }
  }

  private async maybeApplyFunding(now: number): Promise<void> {
    if (now < this.nextFundingAttemptAt) return;

    console.log('\n⏰ Applying hourly funding rate...');
    let result;
    try {
      result = await this.stellar.applyFunding();
    } catch (error) {
      result = { success: false, error: error instanceof Error ? error.message : String(error) };
    }

    const code = result.error ? extractContractErrorCode(result.error) : null;
    const outcome: FundingOutcome = result.success
      ? 'applied'
      : code === 55 || result.error?.includes('FundingIntervalNotElapsed')
        ? 'not-due'
        : 'failed';

    switch (outcome) {
      case 'applied':
        this.stats.fundingApplications++;
        this.fundingFailureStreak = 0;
        this.state.lastFundingSubmitTime = now;
        saveKeeperState(this.config.stateFilePath, this.state);
        this.nextFundingAttemptAt = now + FUNDING_INTERVAL_MS;
        console.log('   ✅ Funding rate applied');
        break;

      case 'not-due':
        // Contract clock hasn't elapsed — healthy. Probe again in a few
        // minutes (the exact on-chain last_funding_time is not exposed).
        this.fundingFailureStreak = 0;
        this.nextFundingAttemptAt = now + FUNDING_NOT_DUE_RETRY_MS;
        console.log('   ⏳ Funding not due yet (#55) — retrying in 5m');
        break;

      case 'failed':
        this.fundingFailureStreak++;
        this.nextFundingAttemptAt = now + FUNDING_FAILED_RETRY_MS;
        console.log(`   ❌ Funding rate application failed (streak ${this.fundingFailureStreak}): ${result.error}`);
        if (this.fundingFailureStreak >= FUNDING_FAILURE_ALERT_THRESHOLD) {
          void sendAlert(
            'warn',
            'apply_funding failing repeatedly',
            `${this.fundingFailureStreak} consecutive failures. Latest: ${result.error}`,
          );
        }
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════════════════

  /** Log a noisy per-entity line at most once per THROTTLED_LOG_INTERVAL_MS. */
  private logThrottled(key: string, message: string): void {
    const now = Date.now();
    const last = this.throttledLogAt.get(key) ?? 0;
    if (now - last < THROTTLED_LOG_INTERVAL_MS) return;
    this.throttledLogAt.set(key, now);
    console.warn(`\n${message}`);

    if (this.throttledLogAt.size > 500) {
      for (const [k, at] of this.throttledLogAt) {
        if (now - at >= THROTTLED_LOG_INTERVAL_MS) this.throttledLogAt.delete(k);
      }
    }
  }

  private formatAmount(amount: bigint, decimals: number = 7): string {
    const divisor = BigInt(10 ** decimals);
    const whole = amount / divisor;
    const fraction = amount % divisor;
    return `${whole}.${fraction.toString().padStart(decimals, '0').slice(0, 4)}`;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Entry point
async function main(): Promise<void> {
  const keeper = new KeeperBot();
  await keeper.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
