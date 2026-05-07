import { Card, CardContent } from '@/components/ui';
import { VaultCard } from '@/components/vault/VaultCard';
import { listVaults } from '@/lib/api/vaults';
import type { VaultRow } from '@/types/vault';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function VaultsPage() {
  let vaults: VaultRow[] = [];
  let error: string | null = null;
  try {
    vaults = await listVaults({ limit: 100 });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-6xl">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Vault Marketplace</h1>
        <p className="text-zinc-400 mt-2">
          User-created trading vaults. Deposit USDC, share in the leader's PnL,
          withdraw any time.
        </p>
      </header>

      {error && (
        <Card className="border-red-500/30 mb-6">
          <CardContent className="p-4 text-red-400 text-sm">
            Could not reach the API gateway. Check{' '}
            <code className="text-xs">NEXT_PUBLIC_NOETHER_API_URL</code>. ({error})
          </CardContent>
        </Card>
      )}

      {!error && vaults.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-zinc-400">
            <p className="text-lg mb-2">No vaults yet.</p>
            <p className="text-sm">
              The vault factory contract is deployed and listening — first vault
              creation will land here.
            </p>
          </CardContent>
        </Card>
      )}

      {vaults.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vaults.map((v) => (
            <VaultCard key={v.id} vault={v} />
          ))}
        </div>
      )}
    </main>
  );
}
