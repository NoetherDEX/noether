/**
 * Noether Keeper Bot - Position/Order Discovery (Phase 4)
 *
 * The market's global Vec indexes (AllPositions / AllOrders) are gone: every
 * open and close used to rewrite them in full, which cost O(open) per trade
 * and made every transaction race every other on one shared ledger entry.
 * The upgraded contract keeps O(1) counters instead, and discovery becomes a
 * CHAIN WALK: read Position(id) / Order(id) ledger entries directly (no view
 * function, no simulation) and reconcile what was found against the
 * OpenPositionCount / OpenOrderCount checksums.
 *
 * Cost model — O(open + new), never O(total ever issued): ids are never
 * reused, so once id N has been examined every id ≤ N that was not live is
 * dead FOREVER. The persisted state is a watermark (highest id ever
 * examined) plus the known-live set; each cycle re-reads only the known-live
 * entries (liveness recheck) and the fresh ids above the watermark. Without
 * this, a market that has issued 30k ids would cost ~150 getLedgerEntries
 * batches per 5s keeper cycle; with it, the full-history walk happens once
 * at first boot and each cycle after touches a few dozen keys.
 *
 * Trust rule: the watermark and live set only persist on a cycle whose
 * checksum agreed — the counter when it exists (post-upgrade), or the legacy
 * view's set in shadow mode (pre-upgrade). The one thing that can make a
 * live position read as absent is an archived (TTL-expired) entry, and that
 * is precisely a checksum mismatch: found < counted → alert, hold state,
 * reuse the previous snapshot for one cycle.
 *
 * Modes (KEEPER_DISCOVERY):
 *   legacy — call the pre-upgrade get_all_* views. Default.
 *   shadow — legacy stays authoritative; the walk runs alongside every cycle
 *            and set-parity is logged/alerted. The 1h staging gate.
 *   chain  — the walk is authoritative; legacy views no longer exist.
 * In legacy/shadow, a market whose views have been DELETED (upgraded before
 * the env flag was flipped) is detected by the caller, which falls forward
 * to this walk as an emergency path so liquidations never silently stop.
 */

import { xdr, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';
import { StellarClient } from './stellar';
import { sendAlert } from './alerts';
import { DiscoveryState, EntityWalkState } from './types';

export interface DiscoverySnapshot {
  positionIds: bigint[];
  orderIds: bigint[];
}

/** Unit DataKey variants encode as scvVec([scvSymbol(name)]). */
function unitKey(name: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
}

/** Tuple DataKey variants encode as scvVec([scvSymbol(name), args…]). */
function idKey(name: string, id: bigint): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name), nativeToScVal(id, { type: 'u64' })]);
}

const KEY_POSITION_COUNTER = unitKey('PositionCounter');
const KEY_ORDER_COUNTER = unitKey('OrderCounter');
const KEY_OPEN_POSITION_COUNT = unitKey('OpenPositionCount');
const KEY_OPEN_ORDER_COUNT = unitKey('OpenOrderCount');

/** OrderStatus::Pending — the only status that counts as live. */
const ORDER_STATUS_PENDING = 0;

export function emptyDiscoveryState(): DiscoveryState {
  return {
    positions: { watermark: '0', live: [] },
    orders: { watermark: '0', live: [] },
  };
}

interface WalkResult {
  liveIds: bigint[];
  /** Checksum entry value, or null when the key does not exist (pre-upgrade). */
  counted: number | null;
  nextState: EntityWalkState;
}

/** Consecutive mismatches on one id space before the alert escalates —
 *  a race self-heals in one cycle; three in a row is an archived entry or
 *  a counter bug and someone has to look at it. */
const MISMATCH_ESCALATION_STREAK = 3;

export class ChainDiscovery {
  private lastGoodPositions: bigint[] | null = null;
  private lastGoodOrders: bigint[] | null = null;
  private positionMismatchStreak = 0;
  private orderMismatchStreak = 0;

  constructor(
    private readonly stellar: StellarClient,
    private readonly state: DiscoveryState,
  ) {}

  /**
   * Walk both id spaces and return the live sets. THROWS on transport
   * failure (an error is not an empty market).
   *
   * The two id spaces are gated INDEPENDENTLY: an order-side mismatch must
   * not discard a perfectly validated fresh position set — liquidations
   * ride the position walk. A mismatching side holds its persisted state,
   * serves its previous good set for the cycle, and escalates from warn to
   * critical once the mismatch stops looking like a race.
   *
   * `expected` (shadow mode) supplies the legacy views' sets as the
   * checksum when the on-chain counters do not exist yet — without it a
   * pre-upgrade walk has nothing to validate against and will not persist
   * its state.
   */
  async discover(expected?: DiscoverySnapshot): Promise<DiscoverySnapshot> {
    const control = await this.stellar.getMarketDataEntries([
      KEY_POSITION_COUNTER,
      KEY_ORDER_COUNTER,
      KEY_OPEN_POSITION_COUNT,
      KEY_OPEN_ORDER_COUNT,
    ]);
    const positionCounter = readU64(control, KEY_POSITION_COUNTER) ?? 0n;
    const orderCounter = readU64(control, KEY_ORDER_COUNTER) ?? 0n;
    const openPositions = readU32(control, KEY_OPEN_POSITION_COUNT);
    const openOrders = readU32(control, KEY_OPEN_ORDER_COUNT);

    const positions = await this.walk(
      'Position',
      this.state.positions,
      positionCounter,
      openPositions,
      // A position row that exists is live; deleted rows are gone entirely.
      () => true,
    );
    const orders = await this.walk(
      'Order',
      this.state.orders,
      orderCounter,
      openOrders,
      // Orders are status-updated, never deleted: terminal reads as dead.
      (val) => orderStatusOf(val) === ORDER_STATUS_PENDING,
    );

    const positionIds = checksumOk(positions, expected?.positionIds)
      ? this.acceptPositions(positions)
      : await this.holdPositions(positions);
    const orderIds = checksumOk(orders, expected?.orderIds)
      ? this.acceptOrders(orders)
      : await this.holdOrders(orders);

    return { positionIds, orderIds };
  }

  private acceptPositions(result: WalkResult): bigint[] {
    this.state.positions = result.nextState;
    this.lastGoodPositions = result.liveIds;
    this.positionMismatchStreak = 0;
    return result.liveIds;
  }

  private acceptOrders(result: WalkResult): bigint[] {
    this.state.orders = result.nextState;
    this.lastGoodOrders = result.liveIds;
    this.orderMismatchStreak = 0;
    return result.liveIds;
  }

  private async holdPositions(result: WalkResult): Promise<bigint[]> {
    this.positionMismatchStreak += 1;
    await this.mismatchAlert('position', result, this.positionMismatchStreak, this.state.positions.watermark);
    // Reuse the prior good set for the cycle; with none (first cycle),
    // acting on what the walk did find beats acting on nothing.
    return this.lastGoodPositions ?? result.liveIds;
  }

  private async holdOrders(result: WalkResult): Promise<bigint[]> {
    this.orderMismatchStreak += 1;
    await this.mismatchAlert('order', result, this.orderMismatchStreak, this.state.orders.watermark);
    return this.lastGoodOrders ?? result.liveIds;
  }

  private async mismatchAlert(
    entity: 'position' | 'order',
    result: WalkResult,
    streak: number,
    watermark: string,
  ): Promise<void> {
    const escalated = streak >= MISMATCH_ESCALATION_STREAK;
    await sendAlert(
      escalated ? 'critical' : 'warn',
      escalated
        ? `discovery ${entity} checksum mismatch persists`
        : `discovery ${entity} checksum mismatch`,
      `walked=${result.liveIds.length} counted=${result.counted} streak=${streak} — ` +
        `state held at watermark ${watermark}; ` +
        (escalated
          ? `this is no longer a race: an archived ${entity} entry or a counter bug ` +
            `is hiding live state from the keeper and needs a human`
          : `one-off mismatches are usually a trade landing mid-walk and self-heal`),
    );
  }

  private async walk(
    entity: 'Position' | 'Order',
    prior: EntityWalkState,
    counter: bigint,
    counted: number | null,
    isLive: (val: xdr.ScVal) => boolean,
  ): Promise<WalkResult> {
    const watermark = BigInt(prior.watermark);
    const candidates: bigint[] = [];
    // Known-live ids get a liveness recheck every cycle…
    for (const id of prior.live) candidates.push(BigInt(id));
    // …and only ids the walk has never seen extend the range.
    for (let id = watermark + 1n; id <= counter; id++) candidates.push(id);

    const keys = candidates.map((id) => idKey(entity, id));
    const found = keys.length > 0 ? await this.stellar.getMarketDataEntries(keys) : new Map();

    const liveIds: bigint[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const val = found.get(keys[i].toXDR('base64'));
      if (val !== undefined && isLive(val)) liveIds.push(candidates[i]);
    }
    liveIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    return {
      liveIds,
      counted,
      nextState: {
        watermark: (counter > watermark ? counter : watermark).toString(),
        live: liveIds.map(String),
      },
    };
  }
}

/**
 * A walk is trusted when the on-chain counter agrees with what it found —
 * or, pre-upgrade (counter absent), when the legacy view's set does. With
 * neither anchor the state is not persisted.
 */
function checksumOk(result: WalkResult, expected?: bigint[]): boolean {
  if (result.counted !== null) return result.counted === result.liveIds.length;
  if (expected !== undefined) {
    if (expected.length !== result.liveIds.length) return false;
    const walked = new Set(result.liveIds.map(String));
    return expected.every((id) => walked.has(String(id)));
  }
  return false;
}

function readU64(entries: Map<string, xdr.ScVal>, key: xdr.ScVal): bigint | null {
  const val = entries.get(key.toXDR('base64'));
  if (val === undefined) return null;
  return BigInt(scValToNative(val));
}

function readU32(entries: Map<string, xdr.ScVal>, key: xdr.ScVal): number | null {
  const val = entries.get(key.toXDR('base64'));
  if (val === undefined) return null;
  return Number(scValToNative(val));
}

/**
 * Pull `status` out of a raw Order ledger value. OrderStatus is a C-like
 * enum with explicit discriminants, so it decodes to a plain number.
 */
function orderStatusOf(val: xdr.ScVal): number {
  const order = scValToNative(val) as { status?: number | bigint };
  return Number(order?.status ?? -1);
}

/** Symmetric difference for shadow parity checks, as printable strings. */
export function setDiff(a: bigint[], b: bigint[]): { onlyA: string[]; onlyB: string[] } {
  const setA = new Set(a.map(String));
  const setB = new Set(b.map(String));
  return {
    onlyA: [...setA].filter((id) => !setB.has(id)),
    onlyB: [...setB].filter((id) => !setA.has(id)),
  };
}
