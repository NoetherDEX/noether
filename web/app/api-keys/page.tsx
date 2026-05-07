import { Card, CardContent } from '@/components/ui';
import { ApiKeyIssueCard } from '@/components/keys/ApiKeyIssueCard';

export const dynamic = 'force-dynamic';

export default function ApiKeysPage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold">API Keys</h1>
        <p className="text-zinc-400 mt-2">
          Issue a key to drive the Noether API from a script, bot, or your
          own dashboard. Authentication is wallet-bound: only addresses you
          control can issue keys, and every authed call is bound to the
          owner of the issuing key.
        </p>
      </header>

      <ApiKeyIssueCard />

      <Card>
        <CardContent className="p-5 text-sm space-y-2">
          <h3 className="font-medium">How it works</h3>
          <ol className="list-decimal pl-5 text-zinc-400 space-y-1">
            <li>The gateway returns 32 random bytes for your address.</li>
            <li>Your wallet signs the bytes (the SDK wraps them in a
                SEP-10-style sequence-0 tx so any Stellar wallet can sign).</li>
            <li>The gateway verifies via{' '}
                <code className="text-xs">Keypair.fromPublicKey(addr).verify(...)</code>{' '}
                and returns a fresh keyId + secret.</li>
            <li>Use{' '}
                <code className="text-xs">Authorization: Bearer keyId:secret</code>{' '}
                on every authed call.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 text-sm">
          <h3 className="font-medium mb-2">Tier limits</h3>
          <ul className="text-zinc-400 space-y-1">
            <li><code className="text-xs">public</code> (IP-bound): 60 req/min</li>
            <li><code className="text-xs">standard</code> (default key): 600 req/min</li>
            <li><code className="text-xs">market_maker</code> (admin-promoted): 6000 req/min</li>
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
