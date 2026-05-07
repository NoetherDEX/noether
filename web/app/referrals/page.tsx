import { Card, CardContent } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ReferralsPage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Referrals</h1>
        <p className="text-zinc-400 mt-2">
          Earn 10% of every fee your referees pay. They get 4% off every trade.
        </p>
      </header>

      <Card>
        <CardContent className="p-6 space-y-3">
          <h2 className="font-medium">Sign in to view your referral dashboard</h2>
          <p className="text-sm text-zinc-400">
            The referral dashboard is gated behind an API key issued from your
            connected Stellar wallet. Once you sign in, this page shows:
          </p>
          <ul className="text-sm text-zinc-400 list-disc pl-5 space-y-1">
            <li>Your share-link with a one-click copy.</li>
            <li>Live earnings: total volume generated, lifetime earned, and
                currently claimable balance.</li>
            <li>A trade-by-trade log of fees you've earned on.</li>
            <li>Claim history for every withdrawal of your earnings.</li>
          </ul>
          <p className="text-sm text-zinc-500">
            Connect your wallet from the navbar to issue a key — the wallet
            challenge / signature flow is the same one used elsewhere on the
            app.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-2">
          <h3 className="font-medium">How does it work?</h3>
          <ul className="text-sm text-zinc-400 list-disc pl-5 space-y-1">
            <li>
              <span className="text-zinc-200 font-medium">You </span>
              create a unique short code (3–16 characters) once your 14-day
              trading volume crosses the threshold.
            </li>
            <li>
              <span className="text-zinc-200 font-medium">Your referees </span>
              sign in with the link <code className="text-xs">?ref=YOURCODE</code>.
              The contract binds them to you on their first authed call.
            </li>
            <li>
              <span className="text-zinc-200 font-medium">On every fee </span>
              the market contract pays them, the referral contract takes the
              10% you've earned and credits your claimable balance.
            </li>
            <li>
              <span className="text-zinc-200 font-medium">Claim </span>
              whenever — the contract releases the USDC straight to your
              Stellar wallet on a single transaction.
            </li>
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
