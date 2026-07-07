import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui';
import { VaultMetrics } from '@/components/vault/VaultMetrics';
import { LeaderManageGate } from '@/components/vault/LeaderManageGate';
import { getVault } from '@/lib/api/vaults';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function VaultManagePage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 0) notFound();
  const vault = await getVault(id);
  if (!vault) notFound();

  return (
    <main className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
      <div>
        <Link href={`/vaults/${id}`} className="text-sm text-zinc-400 hover:text-zinc-200">
          ← {vault.name}
        </Link>
      </div>

      <header>
        <h1 className="text-3xl font-bold">Manage {vault.name}</h1>
        <p className="text-sm text-zinc-500 mt-1 font-mono break-all">
          Leader: {vault.leader}
        </p>
      </header>

      <VaultMetrics vault={vault} />

      <Card>
        <CardContent className="p-5 text-sm text-zinc-400 space-y-2">
          <h3 className="font-medium text-zinc-200">Reminders</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Every open / close call resyncs the vault's accounting from
                the on-chain USDC balance.</li>
            <li>Leader minimum 5% invariant is enforced after each trade —
                a position that would push your share below 5% reverts.</li>
            <li>Profit share ({vault.profitShareBps / 100}% of liquid-NAV gain
                above HWM) is paid out via the Claim button. HWM resets
                afterward.</li>
          </ul>
        </CardContent>
      </Card>

      <LeaderManageGate vault={vault} />
    </main>
  );
}
