'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Header } from '@/components/layout';
import { VaultCard } from '@/components/vault/VaultCard';
import { CreateVaultButton } from '@/components/vault/CreateVaultButton';
import { listAllVaultsOnChain } from '@/lib/stellar/vaultFactory';
import { listVaults } from '@/lib/api/vaults';
import { vaultRowFromOnChain, type VaultRow } from '@/types/vault';
import { CONTRACTS } from '@/lib/utils/constants';

/**
 * Marketplace page. Base list (id / leader / name / TVL / NAV /
 * paused) comes from the chain directly so the page works even if
 * the API gateway is down. Aggregates (APY, drawdown, depositor
 * count, open trades, closed-trade PnL) are overlaid from the API
 * when reachable — they aren't tracked by the contract itself.
 * If the API call fails we still render the cards, the aggregate
 * tiles just show "—".
 */
export default function VaultsPage() {
  const [vaults, setVaults] = useState<VaultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

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
          // gateway. If it's down, the cards still render with on-chain
          // data and the aggregate tiles fall back to em-dash.
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
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Header />

      <main className="pt-16 pb-20">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-12">
          {/* ─── Noether Vault hero ─────────────────────────────────────── */}
          <section className="rounded-2xl border border-white/10 bg-card p-6 md:p-8">
            <div className="flex items-start justify-between flex-wrap gap-6">
              <div className="flex-1 min-w-[260px]">
                <span className="text-[10px] md:text-xs uppercase tracking-[0.18em] text-yellow-500/90 font-medium">
                  Protocol Vault · Default
                </span>
                <h1 className="mt-3 text-2xl md:text-4xl font-bold">Noether Vault</h1>
                <p className="mt-3 text-sm md:text-base text-muted-foreground max-w-2xl">
                  Protocol-managed liquidity. Deposit USDC, get NOE tokens that
                  accrue trading fees from every market trade, withdraw any time.
                  No leader, no opt-in — this is the simplest way to earn on Noether.
                </p>

                <div className="mt-6 grid grid-cols-3 gap-4 md:gap-6 max-w-lg">
                  <div>
                    <div className="text-xs text-muted-foreground">APR</div>
                    <div className="mt-1 text-lg md:text-2xl font-bold font-mono text-green-400">
                      ~12.5%
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">NOE Price</div>
                    <div className="mt-1 text-lg md:text-2xl font-bold font-mono">
                      $1.000
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Withdrawals</div>
                    <div className="mt-1 text-lg md:text-2xl font-bold">Instant</div>
                  </div>
                </div>
              </div>

              <Link
                href="/vault"
                className="self-stretch md:self-center inline-flex items-center justify-center gap-2 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-black font-medium px-6 py-3 transition-colors"
              >
                Open Noether Vault
                <span aria-hidden>→</span>
              </Link>
            </div>
          </section>

          {/* ─── Leader vaults (advanced / opt-in) ───────────────────────── */}
          <section>
            <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
              <div>
                <h2 className="text-xl md:text-2xl font-bold">Leader Vaults</h2>
                <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
                  Advanced: follow a specific trader. Deposit USDC into their
                  vault, they trade with the pooled capital, you share their PnL.
                  Anyone can launch one — leaders keep 10% of profits.
                </p>
              </div>
              <CreateVaultButton />
            </div>

            {loading && (
              <div className="rounded-2xl border border-white/10 bg-card/40 p-10 text-center">
                <p className="text-sm text-muted-foreground">Loading vaults from chain…</p>
              </div>
            )}

            {!loading && err && (
              <div className="rounded-2xl border border-dashed border-white/10 bg-card/40 p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  Could not load vaults from chain right now. Refresh in a moment.
                </p>
                <p className="mt-2 text-xs text-muted-foreground/60">{err}</p>
              </div>
            )}

            {!loading && !err && vaults.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/10 bg-card/40 p-10 text-center">
                <p className="text-sm md:text-base text-muted-foreground">
                  No leader vaults yet.
                </p>
                <p className="mt-2 text-xs md:text-sm text-muted-foreground/70 max-w-md mx-auto">
                  Most users just deposit into the Noether Vault above. Leader
                  vaults are for traders who want to manage capital on behalf
                  of followers and earn a share of the profits.
                </p>
              </div>
            )}

            {vaults.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {vaults.map((v) => (
                  <VaultCard key={v.id} vault={v} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
