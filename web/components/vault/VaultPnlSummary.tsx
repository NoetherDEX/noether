'use client';

import { Card, CardContent } from '@/components/ui';
import { fmtUsdc7 } from '@/lib/utils/format';
import type { VaultActivityRow, VaultRow, VaultTradeRow } from '@/types/vault';

function fmtBps(bps: number | undefined, signed = false): string {
  if (bps == null) return '—';
  const pct = bps / 100;
  return `${signed && pct > 0 ? '+' : ''}${pct.toFixed(pct < 10 ? 2 : 1)}%`;
}

/**
 * PnL summary + sparkline. Maps to the SCF Tranche 2 deliverable:
 * the per-vault detail page needs to surface "PnL history".
 *
 * Anchors at vault creation (PnL = 0), then steps the curve at
 * every leader_close by the trade's settled pnl (read from the
 * matching market position_closed event via vault_trades.pnl).
 * The end-of-curve value equals vault.closedTradePnl (sum of all
 * close pnls). Leader fee-share claims are not plotted here —
 * they live in their own "Leader Fees Claimed" tile in VaultMetrics.
 */
export function VaultPnlSummary({
  vault,
  deposits,
  withdraws,
  feeClaims,
  trades,
}: {
  vault: VaultRow;
  deposits: VaultActivityRow[];
  withdraws: VaultActivityRow[];
  feeClaims: VaultActivityRow[];
  trades: VaultTradeRow[];
}) {
  const totalDeposits = deposits.reduce((acc, r) => acc + BigInt(r.amount), 0n);
  const totalWithdraws = withdraws.reduce((acc, r) => acc + BigInt(r.amount), 0n);
  const totalFees = feeClaims.reduce((acc, r) => acc + BigInt(r.amount), 0n);

  // Lifetime closed-trade PnL. Prefer the API-aggregated value when
  // available; fall back to summing the trade pnls we have on hand
  // (matches when the API and trade list are consistent).
  const closes = trades.filter((x) => x.action === 'close' && x.pnl != null);
  const sumClosesFromTrades = closes.reduce((acc, t) => acc + BigInt(t.pnl ?? '0'), 0n);
  const realized = vault.closedTradePnl != null ? BigInt(vault.closedTradePnl) : sumClosesFromTrades;

  type Point = { ts: number; pnl: number };
  const points: Point[] = [{ ts: vault.createdAt, pnl: 0 }];
  let running = 0;
  for (const t of [...closes].sort((a, b) => a.ts - b.ts)) {
    running += Number(t.pnl ?? '0') / 1e7;
    points.push({ ts: t.ts, pnl: running });
  }
  points.push({ ts: Date.now() / 1000, pnl: Number(realized) / 1e7 });

  const minPnl = Math.min(...points.map((p) => p.pnl), 0);
  const maxPnl = Math.max(...points.map((p) => p.pnl), 0.000001);
  const range = maxPnl - minPnl || 1;
  const tsMin = points[0]!.ts;
  const tsMax = points[points.length - 1]!.ts;
  const tsSpan = Math.max(1, tsMax - tsMin);

  const W = 800;
  const H = 120;
  const pad = 8;
  const xs = (ts: number) => pad + ((ts - tsMin) / tsSpan) * (W - 2 * pad);
  const ys = (v: number) => pad + (1 - (v - minPnl) / range) * (H - 2 * pad);
  const d = 'M ' + points.map((p) => `${xs(p.ts).toFixed(2)},${ys(p.pnl).toFixed(2)}`).join(' L ');
  const zeroY = ys(0);
  const positive = Number(realized) >= 0;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-medium text-foreground">PnL History</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Closed-trade PnL over time
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-faint">
              Closed-trade PnL
            </p>
            <p
              className={`font-mono tabular-nums text-lg font-medium ${
                positive ? 'text-long' : 'text-short'
              }`}
            >
              {positive ? '+' : '-'}${fmtUsdc7(realized < 0n ? -realized : realized)}
            </p>
          </div>
        </div>

        <div className="px-6 pt-4">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
            <line
              x1={pad}
              x2={W - pad}
              y1={zeroY}
              y2={zeroY}
              stroke="hsl(var(--border))"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <path
              d={d}
              fill="none"
              stroke={positive ? 'hsl(var(--long))' : 'hsl(var(--short))'}
              strokeWidth={1.5}
            />
            <circle
              cx={xs(points[points.length - 1]!.ts)}
              cy={ys(points[points.length - 1]!.pnl)}
              r={3}
              fill={positive ? 'hsl(var(--long))' : 'hsl(var(--short))'}
            />
          </svg>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 border-t border-border mt-4">
          <Tile
            label={vault.apyKind === 'inception' ? 'Since inception' : 'APY'}
            value={fmtBps(vault.apyBps, true)}
          />
          <Tile label="Max drawdown" value={fmtBps(vault.drawdownBps)} />
          <Tile label="Inflow" value={`$${fmtUsdc7(totalDeposits)}`} />
          <Tile label="Outflow" value={`$${fmtUsdc7(totalWithdraws + totalFees)}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-faint">{label}</p>
      <p className="font-mono text-sm font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}
