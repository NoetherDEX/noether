'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Header } from '@/components/layout';
import { Badge } from '@/components/ui';
import { CreateVaultButton } from '@/components/vault/CreateVaultButton';
import { listAllVaultsOnChain } from '@/lib/stellar/vaultFactory';
import { getNoePrice } from '@/lib/stellar/vault';
import { listVaults } from '@/lib/api/vaults';
import { vaultRowFromOnChain, vaultNav, type VaultRow } from '@/types/vault';
import { CONTRACTS } from '@/lib/utils/constants';
import { fmtUsdc7 } from '@/lib/utils/format';
import { toUserMessage } from '@/lib/utils/userError';

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function fmtBps(bps: number | undefined, signed = false): string {
  if (bps == null) return '—';
  const pct = bps / 100;
  const sign = signed && pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(pct < 10 ? 2 : 1)}%`;
}

/**
 * Marketplace page. Base list (id / leader / name / TVL / NAV /
 * paused) comes from the chain directly so the page works even if
 * the API gateway is down. Aggregates (APY, drawdown, depositor
 * count, open trades, closed-trade PnL) are overlaid from the API
 * when reachable — they aren't tracked by the contract itself.
 * If the API call fails we still render the rows, the aggregate
 * cells just show "—".
 */
export default function VaultsPage() {
  const [vaults, setVaults] = useState<VaultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // B17: the browsing job — sortable/filterable/searchable, TVL-first
  // (the old oldest-first unsortable grid failed it).
  const [sortBy, setSortBy] = useState<'tvl' | 'apy' | 'newest' | 'depositors'>('tvl');
  const [hidePaused, setHidePaused] = useState(false);
  const [search, setSearch] = useState('');
  // Live NOE price for the protocol-vault panel — null means "unknown",
  // rendered as '—' (never a fabricated $1.000).
  const [noePrice, setNoePrice] = useState<bigint | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNoePrice().then((price) => {
      if (!cancelled) setNoePrice(price);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Use the admin address as the simulate source — it always
        // exists and isn't credited for anything; sim calls are free.
        const source =
          process.env.NEXT_PUBLIC_ADMIN_PUBLIC_KEY ??
          'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';
        void CONTRACTS; // keep tree-shake from dropping the constants module
        const [onchain, apiRows] = await Promise.all([
          listAllVaultsOnChain(source),
          // Aggregates are best-effort — never block the page on the
          // gateway. If it's down, the rows still render with on-chain
          // data and the aggregate cells fall back to em-dash.
          listVaults({ limit: 50 }).catch(() => [] as VaultRow[]),
        ]);
        if (cancelled) return;
        const apiById = new Map(apiRows.map((v) => [v.id, v]));
        setVaults(
          onchain.map((info) => {
            const base = vaultRowFromOnChain(info);
            const enrich = apiById.get(base.id);
            if (!enrich) return base;
            return {
              ...base,
              apyBps: enrich.apyBps,
              apyKind: enrich.apyKind,
              drawdownBps: enrich.drawdownBps,
              depositorCount: enrich.depositorCount,
              openPositions: enrich.openPositions,
              tradeCount: enrich.tradeCount,
              closedTradePnl: enrich.closedTradePnl,
            };
          }),
        );
        setErr(null);
      } catch (e) {
        if (cancelled) return;
        setErr(toUserMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Aggregate header stats — derived from the already-loaded rows.
  const leaderTvl =
    !loading && !err
      ? vaults.reduce((acc, v) => acc + BigInt(v.totalUsdc), 0n)
      : null;

  // B17: filter + sort applied client-side over the loaded rows.
  const q = search.trim().toLowerCase();
  const visibleVaults = vaults
    .filter((v) => (hidePaused ? !v.paused : true))
    .filter(
      (v) =>
        !q ||
        v.name.toLowerCase().includes(q) ||
        v.leader.toLowerCase().includes(q)
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'apy':
          // nulls (no aggregate yet) sink to the bottom
          return (b.apyBps ?? Number.NEGATIVE_INFINITY) - (a.apyBps ?? Number.NEGATIVE_INFINITY);
        case 'newest':
          return (b.createdAt ?? 0) - (a.createdAt ?? 0);
        case 'depositors':
          return (b.depositorCount ?? -1) - (a.depositorCount ?? -1);
        case 'tvl':
        default: {
          const at = BigInt(a.totalUsdc);
          const bt = BigInt(b.totalUsdc);
          return bt > at ? 1 : bt < at ? -1 : 0;
        }
      }
    });

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-12 pb-16">
        <div className="max-w-7xl mx-auto px-4">
          {/* ─── Page header ────────────────────────────────────────────── */}
          <div className="flex items-end justify-between gap-6 flex-wrap border-b border-border py-8">
            <div>
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
                Earn · Vaults
              </span>
              <h1 className="mt-2 text-xl font-medium text-foreground">Vaults</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Deposit USDC into the protocol vault, or follow a specific
                trader through a leader vault.
              </p>
            </div>
            <div className="flex items-baseline gap-8">
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wide text-faint">
                  Leader vaults
                </div>
                <div className="mt-1 text-sm font-mono tabular-nums text-foreground">
                  {!loading && !err ? vaults.length : '—'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wide text-faint">
                  Leader TVL (liquid)
                </div>
                <div className="mt-1 text-sm font-mono tabular-nums text-foreground">
                  {leaderTvl != null ? `$${fmtUsdc7(leaderTvl)}` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* ─── Featured: Noether protocol vault ───────────────────────── */}
          <section className="mt-8">
            <div className="grid lg:grid-cols-[1fr_auto] gap-6 items-center rounded-lg border border-border bg-surface p-6">
              <div className="min-w-0">
                <span className="inline-block rounded-sm bg-primary/10 text-primary font-mono text-[10px] uppercase tracking-wide px-1.5 py-0.5">
                  Protocol Vault
                </span>
                <h2 className="mt-2 text-lg font-medium text-foreground">Noether Vault</h2>
                <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl line-clamp-2">
                  Protocol-managed liquidity. Deposit USDC, get NOE tokens that
                  accrue trading fees from every market trade, withdraw any time
                  the pool has free liquidity.
                </p>
                <p className="mt-1 text-[11px] text-faint max-w-2xl">
                  The pool takes the other side of every trade — its value falls
                  when traders profit, so principal is at risk.
                </p>

                <div className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-faint">APR</span>
                    <span className="text-sm font-mono tabular-nums text-foreground">
                      Variable
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-faint">
                      NOE Price
                    </span>
                    <span className="text-sm font-mono tabular-nums text-foreground">
                      {noePrice != null ? `$${fmtUsdc7(noePrice, 3)}` : '—'}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-faint">
                      Withdrawals
                    </span>
                    <span className="text-sm font-mono tabular-nums text-foreground">
                      Anytime
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex lg:items-center">
                <Link
                  href="/vault"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium px-5 transition-colors"
                >
                  Open Noether Vault
                  <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
          </section>

          {/* ─── Leader vaults (advanced / opt-in) ──────────────────────── */}
          <section className="mt-12">
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-border">
              <h2 className="text-[15px] font-medium text-foreground">Leader Vaults</h2>
              <CreateVaultButton />
            </div>
            <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
              Advanced: follow a specific trader. Deposit USDC into their
              vault, they trade with the pooled capital, you share their PnL.
              Anyone can launch one — leaders keep 10% of profits.
            </p>

            {/* Beta caveat (A20) — until the V-1 accounting fix lands, vault
                numbers count only liquid USDC. Mirrors the detail-page banner. */}
            <div className="mt-4 mb-6 border-l-2 border-primary/60 pl-3 text-xs text-muted-foreground">
              <span className="font-medium text-primary">Beta:</span> leader-vault accounting
              counts only the USDC sitting in the vault. While a leader has open
              positions, TVL, NAV and P&amp;L exclude the deployed capital — and
              withdrawing mid-trade forfeits your share of it. A contract fix is
              scheduled before mainnet.
            </div>

            {loading && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Loading vaults from chain…
              </p>
            )}

            {!loading && err && (
              <div className="py-8">
                <p className="text-sm text-muted-foreground">
                  Could not load vaults from chain right now. Refresh in a moment.
                </p>
                <details className="mt-3">
                  <summary className="cursor-pointer font-mono text-[11px] text-faint">
                    Technical detail
                  </summary>
                  <p className="mt-2 font-mono text-[11px] text-faint break-all">{err}</p>
                </details>
              </div>
            )}

            {/* B17: browse controls — sort, paused filter, leader/name search */}
            {!loading && !err && vaults.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 bg-surface-2 rounded-md p-0.5">
                  {(
                    [
                      ['tvl', 'TVL'],
                      ['apy', 'Yield'],
                      ['newest', 'Newest'],
                      ['depositors', 'Depositors'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setSortBy(key)}
                      aria-pressed={sortBy === key}
                      className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-colors ${
                        sortBy === key
                          ? 'bg-surface-3 text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hidePaused}
                    onChange={(e) => setHidePaused(e.target.checked)}
                    className="accent-[hsl(var(--primary))]"
                  />
                  Hide paused
                </label>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or leader…"
                  aria-label="Search vaults by name or leader address"
                  className="ml-auto h-8 w-full sm:w-56 bg-surface-2 border border-border rounded-md px-3 text-xs text-foreground placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-border-strong"
                />
              </div>
            )}

            {!loading && !err && <LeaderVaultTable vaults={visibleVaults} />}
          </section>
        </div>
      </main>
    </div>
  );
}

/**
 * Dense marketplace table — surfaces the five SCF Tranche 2 metrics
 * (name · APY · TVL · drawdown · depositor count) plus open-trades
 * and NAV as secondary context. Falls back to em-dash when the
 * indexer hasn't produced an aggregate yet (brand-new vault).
 */
function LeaderVaultTable({ vaults }: { vaults: VaultRow[] }) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-[11px] font-medium uppercase tracking-wide text-faint py-2 pr-4">
              Vault
            </th>
            <th className="text-left text-[11px] font-medium uppercase tracking-wide text-faint py-2 pr-4">
              Leader
            </th>
            <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint py-2 pr-4">
              TVL (liquid)
            </th>
            <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint py-2 pr-4">
              Liquid NAV
            </th>
            <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint py-2 pr-4">
              APY
            </th>
            <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint py-2 pr-4">
              Drawdown
            </th>
            <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint py-2 pr-4">
              Depositors
            </th>
            <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint py-2 pr-4">
              Open trades
            </th>
            <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint py-2">
              <span className="sr-only">View</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {vaults.length === 0 && (
            <tr className="h-12 border-b border-border">
              <td colSpan={9} className="text-sm text-muted-foreground">
                No leader vaults yet.{' '}
                <span className="text-xs text-faint">
                  Most users just deposit into the Noether Vault above. Leader
                  vaults are for traders who want to manage capital on behalf
                  of followers and earn a share of the profits.
                </span>
              </td>
            </tr>
          )}
          {vaults.map((v) => {
            const apyClass =
              v.apyBps == null
                ? 'text-foreground'
                : v.apyBps > 0
                ? 'text-long'
                : v.apyBps < 0
                ? 'text-short'
                : 'text-foreground';
            return (
              <tr
                key={v.id}
                onClick={() => router.push(`/vaults/${v.id}`)}
                className="h-12 border-b border-border hover:bg-surface-3/50 cursor-pointer"
              >
                <td className="pr-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-foreground truncate">
                      {v.name}
                    </span>
                    <span className="font-mono text-[11px] text-faint shrink-0">#{v.id}</span>
                    {v.paused && <Badge variant="warning">Paused</Badge>}
                  </div>
                </td>
                <td className="pr-4 font-mono text-xs text-muted-foreground">
                  {shortenAddress(v.leader)}
                </td>
                <td className="pr-4 text-right font-mono tabular-nums text-sm text-foreground">
                  ${fmtUsdc7(v.totalUsdc)}
                </td>
                <td className="pr-4 text-right font-mono tabular-nums text-sm text-foreground">
                  {fmtUsdc7(vaultNav(v), 4)}
                </td>
                <td className={`pr-4 text-right font-mono tabular-nums text-sm ${apyClass}`}>
                  {fmtBps(v.apyBps, true)}
                  {v.apyKind === 'inception' && (
                    <span
                      className="text-faint"
                      title="Since inception — vault is under 7 days old, not an annualized rate"
                    >
                      {' '}*
                    </span>
                  )}
                </td>
                <td className="pr-4 text-right font-mono tabular-nums text-sm text-foreground">
                  {fmtBps(v.drawdownBps)}
                </td>
                <td className="pr-4 text-right font-mono tabular-nums text-sm text-foreground">
                  {v.depositorCount ?? '—'}
                </td>
                <td className="pr-4 text-right font-mono tabular-nums text-sm text-foreground">
                  {v.openPositions ?? '—'}
                </td>
                <td className="text-right">
                  <Link
                    href={`/vaults/${v.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-mono text-xs text-muted-foreground hover:text-primary"
                  >
                    ↳ View
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
