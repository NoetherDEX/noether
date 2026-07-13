import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui';
import { Header } from '@/components/layout';
import { VaultMetrics } from '@/components/vault/VaultMetrics';
import { VaultActivity } from '@/components/vault/VaultActivity';
import { VaultActions } from '@/components/vault/VaultActions';
import { MyVaultPosition } from '@/components/vault/MyVaultPosition';
import { VaultTradeHistory } from '@/components/vault/VaultTradeHistory';
import { VaultPnlSummary } from '@/components/vault/VaultPnlSummary';
import {
  getVault,
  getVaultDeposits,
  getVaultFeeClaims,
  getVaultWithdraws,
  getVaultTrades,
} from '@/lib/api/vaults';
import { getVaultInfo } from '@/lib/stellar/vaultFactory';
import { vaultRowFromOnChain } from '@/types/vault';
import { formatDate } from '@/lib/utils/format';
import { STELLAR_EXPERT_BASE, NULL_ACCOUNT } from '@/lib/utils/constants';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function VaultDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 0) notFound();

  // B15: the gateway is a projection, not the source of truth. A gateway
  // outage (or the indexing window right after create_vault) used to 404 a
  // vault the user just saw — fall back to the on-chain read and mark the
  // page degraded instead.
  let vault = null;
  let degraded = false;
  try {
    vault = await getVault(id);
  } catch {
    degraded = true; // gateway unreachable — try the chain
  }
  if (!vault) {
    const info = await getVaultInfo(NULL_ACCOUNT, id).catch(() => null);
    if (info) {
      vault = vaultRowFromOnChain(info);
      degraded = true;
    }
  }
  if (!vault) notFound();

  const [deposits, withdraws, feeClaims, trades] = await Promise.all([
    getVaultDeposits(id, 200).catch(() => []),
    getVaultWithdraws(id, 200).catch(() => []),
    getVaultFeeClaims(id, 50).catch(() => []),
    getVaultTrades(id, 200).catch(() => []),
  ]);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-12 pb-16">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
          {/* Breadcrumb */}
          <div>
            <Link
              href="/vaults"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← All vaults
            </Link>
          </div>

          {/* B15: chain-fallback state — the numbers are real (on-chain),
              only the indexed history below may lag. */}
          {degraded && (
            <div className="rounded-md border border-primary/25 bg-primary/5 px-4 py-2.5 text-sm text-primary">
              Marketplace data is still syncing — showing live on-chain values.
              Activity and trade history may be incomplete for a minute.
            </div>
          )}

          {/* Header */}
          <div className="border-b border-border pb-8">
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div className="flex-1 min-w-[260px]">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-primary font-medium">
                    Leader Vault · #{vault.id}
                  </span>
                  {vault.paused && <Badge variant="warning">Paused</Badge>}
                </div>
                <h1 className="mt-2 text-xl font-medium text-foreground">{vault.name}</h1>

                <a
                  href={`${STELLAR_EXPERT_BASE}/account/${vault.leader}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors group"
                  title="View leader on stellar.expert"
                >
                  <span>Leader</span>
                  <span className="font-mono">
                    {vault.leader.slice(0, 6)}…{vault.leader.slice(-6)}
                  </span>
                  <span aria-hidden className="opacity-0 group-hover:opacity-100 transition-opacity">
                    ↗
                  </span>
                </a>
                <p className="mt-1 text-xs text-faint font-mono tabular-nums">
                  Created {formatDate(vault.createdAt)}
                </p>
              </div>

              <VaultActions vault={vault} />
            </div>
          </div>

          {/* Beta caveat (A20) — leader-vault accounting counts only liquid
              USDC until the V-1 contract fix lands. */}
          <div className="border-l-2 border-primary/60 pl-3 text-xs text-muted-foreground">
            <span className="font-medium text-primary">Beta:</span> all numbers below count
            only the USDC sitting in the vault. While the leader has open
            positions, TVL, NAV and P&amp;L exclude the deployed capital — and
            withdrawing mid-trade forfeits your share of it.
          </div>

          {/* Stat rows */}
          <VaultMetrics vault={vault} />

          {/* PnL history chart + summary tiles (SCF Tranche 2 deliverable #4) */}
          <VaultPnlSummary
            vault={vault}
            deposits={deposits}
            withdraws={withdraws}
            feeClaims={feeClaims}
            trades={trades}
          />

          {/* User position */}
          <MyVaultPosition vault={vault} deposits={deposits} withdraws={withdraws} />

          {/* Leader trade history (SCF deliverable #4) */}
          <VaultTradeHistory trades={trades} />

          {/* Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            <VaultActivity
              title="Deposits"
              rows={deposits}
              amountLabel="USDC In"
              showShares
            />
            <VaultActivity
              title="Withdraws"
              rows={withdraws}
              amountLabel="USDC Out"
              showShares
            />
          </div>

          <VaultActivity
            title="Leader Fee Claims"
            rows={feeClaims}
            amountLabel="USDC Paid"
            empty="The leader has not claimed any profit share yet."
          />

          {/* How it works (compact) */}
          <div className="rounded-lg border border-border bg-surface overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-sm font-medium text-foreground">How this vault works</h3>
            </div>
            <div className="p-6 text-sm text-muted-foreground space-y-3 leading-relaxed">
              <p>
                Depositors send USDC and receive shares proportional to the current
                liquid NAV. The leader trades the pooled capital through the Noether
                market and takes <span className="text-foreground font-medium">{(vault.profitShareBps / 100).toFixed(1)}%</span> of
                any gain above the high-water mark.
              </p>
              <p>
                Accounting counts only liquid USDC: while the leader has open
                positions, TVL and NAV exclude the deployed capital, and both
                deposits and withdrawals are priced at that reduced liquid NAV.
                Withdrawing mid-trade forfeits your share of the deployed
                capital — the numbers recover only when positions close.
              </p>
              <p>
                The leader is required to hold <span className="text-foreground font-medium">≥ 5% of the vault</span> at
                all times — withdrawals or inflows that would break this
                invariant are rejected on-chain.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
