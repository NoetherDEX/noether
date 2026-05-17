import Link from 'next/link';
import { Card, CardContent } from '@/components/ui';
import { Header } from '@/components/layout';
import { VaultCard } from '@/components/vault/VaultCard';
import { CreateVaultButton } from '@/components/vault/CreateVaultButton';
import { listVaults } from '@/lib/api/vaults';
import type { VaultRow } from '@/types/vault';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function VaultsPage() {
  let vaults: VaultRow[] = [];
  let apiError: string | null = null;
  try {
    vaults = await listVaults({ limit: 100 });
  } catch (err) {
    apiError = err instanceof Error ? err.message : String(err);
  }

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

            {apiError && (
              <Card className="border-red-500/30 mb-4">
                <CardContent className="p-4 text-red-400 text-sm">
                  Could not reach the API gateway. Check{' '}
                  <code className="text-xs">NEXT_PUBLIC_NOETHER_API_URL</code>.{' '}
                  ({apiError})
                </CardContent>
              </Card>
            )}

            {!apiError && vaults.length === 0 && (
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
