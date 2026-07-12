import { Header } from '@/components/layout';
import { ReferralSignIn } from '@/components/referral/ReferralSignIn';
import { ReferralDashboardOrSignIn } from '@/components/referral/ReferralDashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ReferralsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-12 pb-16">
        <div className="max-w-7xl mx-auto px-4">
          {/* Page header row */}
          <header className="border-b border-border py-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
              Growth · Referrals
            </p>
            <h1 className="mt-2 text-xl font-medium">Earn from your network</h1>
            <p className="mt-2 max-w-[560px] text-sm text-muted-foreground line-clamp-2">
              Register your code and grow your network now — fee sharing goes
              live in v1.1: 10% of every fee your referees pay to you, and 4%
              off every trade for them.
            </p>
          </header>

          {/* Two-column body: info rail left, action stack right */}
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8 py-8">
            {/* Left rail — informational, renders in every state */}
            <aside className="lg:sticky lg:top-20 self-start space-y-8">
              {/* How it works — vertical timeline */}
              <section>
                <h2 className="text-[13px] font-medium text-foreground">
                  How does it work?
                </h2>
                <ol className="mt-4">
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
                        Send{' '}
                        <code className="px-1 py-0.5 rounded-sm bg-surface-2 text-primary">
                          ?ref=YOURCODE
                        </code>{' '}
                        to friends. They accept the invite with one signed
                        transaction — from the invitation banner, or by
                        entering your code on this page. The binding is
                        permanent, on-chain.
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
                    last
                  />
                </ol>
              </section>

              {/* Key terms — ledger rows */}
              <section>
                <div className="border-t border-border">
                  <LedgerRow label="Your cut · from v1.1" value="10%" />
                  <LedgerRow label="Referee discount · from v1.1" value="4%" />
                  <LedgerRow label="Settlement" value="On-chain" />
                </div>
                <p className="mt-3 text-[11px] text-faint leading-relaxed">
                  Codes are on-chain: your referees accept the invite with one
                  signed transaction and the binding is permanent — no
                  off-chain bookkeeping, no rugpulls.
                </p>
              </section>
            </aside>

            {/* Right column — the action stack */}
            <div className="min-w-0">
              <ReferralDashboardOrSignIn signInSlot={<ReferralSignIn />} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function LedgerRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5">
      <span className="text-[11px] uppercase tracking-wide text-faint">{label}</span>
      <span className="text-sm font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function Step({
  num,
  title,
  body,
  last = false,
}: {
  num: number;
  title: string;
  body: React.ReactNode;
  last?: boolean;
}) {
  return (
    <li className={`border-l border-border pl-4 ${last ? 'pb-0' : 'pb-6'}`}>
      <span className="font-mono text-[11px] tabular-nums text-primary">
        {String(num).padStart(2, '0')}
      </span>
      <p className="mt-1 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[11px] text-faint leading-relaxed">{body}</p>
    </li>
  );
}
