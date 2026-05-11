import { Card, CardContent } from '@/components/ui';
import { ReferralSignIn } from '@/components/referral/ReferralSignIn';
import { ReferralDashboardOrSignIn } from '@/components/referral/ReferralDashboard';

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

      <ReferralDashboardOrSignIn signInSlot={<ReferralSignIn />} />

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
