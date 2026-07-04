import { Header } from '@/components/layout';
import { ReferralSignIn } from '@/components/referral/ReferralSignIn';
import { ReferralDashboardOrSignIn } from '@/components/referral/ReferralDashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ReferralsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Header />

      <main className="pt-16 pb-20">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
          {/* Hero card */}
          <div className="rounded-2xl border border-white/10 bg-card p-6 md:p-8">
            <span className="text-[10px] md:text-xs uppercase tracking-[0.18em] text-amber-400 font-medium">
              Earn from your network
            </span>
            <h1 className="mt-3 text-3xl md:text-4xl font-bold">Referrals</h1>
            <p className="mt-3 text-sm md:text-base text-muted-foreground max-w-3xl">
              Register your code and grow your network now — fee sharing goes
              live in v1.1: <span className="text-foreground font-medium">10%</span> of
              every fee your referees pay to you, and{' '}
              <span className="text-foreground font-medium">4% off</span> every trade
              for them. Codes are on-chain and bind referees to you on their first
              authed call — no off-chain bookkeeping, no rugpulls.
            </p>

            <div className="mt-6 grid grid-cols-3 gap-4 md:gap-6 max-w-2xl">
              <Pill label="Your cut · from v1.1" value="10%" />
              <Pill label="Referee discount · from v1.1" value="4%" />
              <Pill label="Settlement" value="On-chain" />
            </div>
          </div>

          {/* Dashboard or sign-in (handles code creation, claim, stats) */}
          <ReferralDashboardOrSignIn signInSlot={<ReferralSignIn />} />

          {/* How it works (kompakt, eski /vault'tan) */}
          <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h3 className="text-base font-semibold text-foreground">How does it work?</h3>
            </div>
            <div className="p-6">
              <ol className="space-y-4 text-sm">
                <Step
                  num={1}
                  title="Register a code"
                  body="Sign in with your wallet and pick a unique 3–16 character handle. During the beta, code creation is invite-only (allowlist in the app, not enforced by the contract)."
                />
                <Step
                  num={2}
                  title="Share the link"
                  body={
                    <>
                      Send <code className="text-xs px-1 py-0.5 rounded bg-zinc-900 text-amber-400">?ref=YOURCODE</code>{' '}
                      to friends. The contract binds them to you on their first
                      authed call — permanent, on-chain.
                    </>
                  }
                />
                <Step
                  num={3}
                  title="Earn on every fee — from v1.1"
                  body="Fee accrual ships in v1.1: from then on, every time the market contract collects a fee from a referee, the referral contract credits 10% of it to your claimable balance."
                />
                <Step
                  num={4}
                  title="Claim — from v1.1"
                  body="Payouts go live together with fee accrual in v1.1. Your code and referee bindings are on-chain today and carry over unchanged."
                />
              </ol>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg md:text-2xl font-bold font-mono">{value}</div>
    </div>
  );
}

function Step({
  num,
  title,
  body,
}: {
  num: number;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="flex-none w-7 h-7 rounded-full bg-amber-500/15 text-amber-400 text-xs font-bold flex items-center justify-center mt-0.5">
        {num}
      </span>
      <div className="flex-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-1 text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </li>
  );
}
