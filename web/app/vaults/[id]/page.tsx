import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardContent } from '@/components/ui';
import { VaultMetrics } from '@/components/vault/VaultMetrics';
import { VaultActivity } from '@/components/vault/VaultActivity';
import { VaultActions } from '@/components/vault/VaultActions';
import {
  getVault,
  getVaultDeposits,
  getVaultFeeClaims,
  getVaultWithdraws,
} from '@/lib/api/vaults';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function VaultDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 0) notFound();

  const vault = await getVault(id);
  if (!vault) notFound();

  const [deposits, withdraws, feeClaims] = await Promise.all([
    getVaultDeposits(id, 25).catch(() => []),
    getVaultWithdraws(id, 25).catch(() => []),
    getVaultFeeClaims(id, 25).catch(() => []),
  ]);

  return (
    <main className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
      <div>
        <Link href="/vaults" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← All vaults
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">{vault.name}</h1>
          <p className="text-sm text-zinc-500 mt-1 font-mono break-all">
            Leader: {vault.leader}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            Created {new Date(vault.createdAt * 1000).toLocaleString()} · ID #{vault.id}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {vault.paused && <Badge variant="warning">Paused</Badge>}
          <VaultActions vaultId={vault.id} vaultName={vault.name} paused={vault.paused} />
        </div>
      </header>

      <VaultMetrics vault={vault} />

      <Card>
        <CardContent className="p-5 text-sm space-y-2">
          <h3 className="font-medium">How this vault works</h3>
          <p className="text-zinc-400">
            Depositors send USDC and receive shares proportional to current NAV.
            The leader trades the pooled capital through the Noether market and
            takes a {(vault.profitShareBps / 100).toFixed(1)}% share of any
            gain above the high-water mark. Leaders are required to hold at
            least 5% of the vault themselves at all times — withdrawals or
            inflows that would break this invariant are rejected on-chain.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
    </main>
  );
}
