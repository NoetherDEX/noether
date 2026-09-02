/**
 * Keeper self-reports (POST /v1/oracle/heartbeat), shared across routes.
 *
 * The keeper walks every live position each cycle and reports the market's
 * custody picture — the USDC the market contract holds vs the collateral it
 * is holding for traders (2026-08 guardrail: the pre-fix market paid funding
 * receivers out of that pool and drained it). The gateway only relays the
 * last report; it never computes custody itself, and it never fabricates
 * one — no report, no block.
 */

/** Custody self-report as posted by the keeper. Amounts are 7-decimal USDC i128 strings. */
export interface MarketCustody {
  /** USDC SAC balance of the market contract. */
  marketUsdcBalance: string;
  /**
   * Σ live isolated collateral + Σ open cross-position collateral + Σ cross-margin
   * pools + Σ pending entry-order escrow.
   */
  trackedCustody: string;
  isolatedCollateral: string;
  /**
   * Collateral locked in open cross positions (debited from the pool at open,
   * credited back at close). Absent from keeper builds before 2026-09-02,
   * whose trackedCustody under-counts by exactly this amount.
   */
  crossPositionCollateral?: string;
  crossBalances: string;
  orderEscrow: string;
  /** max(0, trackedCustody − marketUsdcBalance). Anything but "0" means payouts will start failing. */
  deficit: string;
  /** Live positions the report covers. */
  positions: number;
  /** Unix ms the keeper computed it. */
  asOf: number;
}

export interface CustodyReport extends MarketCustody {
  /** Age of the report when served, measured from the keeper's own asOf (NOT the heartbeat that relayed it). */
  ageMs: number;
  /** True past CUSTODY_STALE_MS — the custody check stopped producing reports; treat as unknown, not healthy. */
  stale: boolean;
}

/**
 * Keeper computes custody every minute; five missed computations is a dead
 * check, not a slow one. Measured from asOf because the keeper re-posts its
 * LAST report on every ~30s heartbeat, including when its chain reads are
 * failing — a live heartbeat says nothing about how old the custody data is.
 */
export const CUSTODY_STALE_MS = 5 * 60_000;

const INT_RE = /^-?\d+$/;
const AMOUNT_FIELDS = [
  'marketUsdcBalance',
  'trackedCustody',
  'isolatedCollateral',
  'crossBalances',
  'orderEscrow',
  'deficit',
] as const;
const OPTIONAL_AMOUNT_FIELDS = ['crossPositionCollateral'] as const;

export class KeeperStatusStore {
  private last: { receivedAt: number; body: Record<string, unknown> } | null = null;

  record(body: Record<string, unknown>, receivedAt: number = Date.now()): void {
    this.last = { receivedAt, body };
  }

  latest(): { receivedAt: number; body: Record<string, unknown> } | null {
    return this.last;
  }

  /**
   * The last custody self-report with a valid shape, or null (never reported,
   * or a keeper build that does not report custody). Malformed amounts are
   * rejected wholesale rather than zero-filled — a zero here would read as
   * "no deficit".
   */
  custody(now: number = Date.now()): CustodyReport | null {
    const raw = this.last?.body.custody;
    if (!this.last || typeof raw !== 'object' || raw === null) return null;
    const c = raw as Record<string, unknown>;
    const amounts: Partial<Record<(typeof AMOUNT_FIELDS)[number], string>> = {};
    for (const key of AMOUNT_FIELDS) {
      const v = c[key];
      if (typeof v !== 'string' || !INT_RE.test(v)) return null;
      amounts[key] = v;
    }
    const optional: Partial<Record<(typeof OPTIONAL_AMOUNT_FIELDS)[number], string>> = {};
    for (const key of OPTIONAL_AMOUNT_FIELDS) {
      const v = c[key];
      if (v === undefined) continue;
      if (typeof v !== 'string' || !INT_RE.test(v)) return null;
      optional[key] = v;
    }
    if (!Number.isInteger(c.positions) || !Number.isInteger(c.asOf)) return null;
    // A report is never fresher than its arrival: a keeper clock running
    // ahead (or a bad asOf) must not read as fresh forever.
    const anchor = Math.min(c.asOf as number, this.last.receivedAt);
    const ageMs = Math.max(0, now - anchor);
    return {
      ...(amounts as Record<(typeof AMOUNT_FIELDS)[number], string>),
      ...optional,
      positions: c.positions as number,
      asOf: c.asOf as number,
      ageMs,
      stale: ageMs > CUSTODY_STALE_MS,
    };
  }
}
