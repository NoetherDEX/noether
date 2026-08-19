import type { Logger } from 'pino';

/**
 * Approval notification email via Azure Communication Services. Injected as
 * a dep; without ACS config the noop variant logs and returns false, so
 * approvals NEVER block on email (email_sent_at simply stays null and the
 * admin panel can resend later).
 */

export interface ApprovalEmailer {
  readonly enabled: boolean;
  /** Returns true when the message was accepted for delivery. */
  sendApproval(to: string, wave: string | null): Promise<boolean>;
}

export class NoopEmailer implements ApprovalEmailer {
  readonly enabled = false;

  constructor(private readonly log?: Logger) {}

  async sendApproval(to: string): Promise<boolean> {
    this.log?.info({ to }, 'ACS not configured — approval email skipped');
    return false;
  }
}

export class AcsEmailer implements ApprovalEmailer {
  readonly enabled = true;
  // Lazy client so the (heavy) Azure SDK only loads when ACS is configured.
  private clientPromise?: Promise<{
    beginSend(message: unknown): Promise<{ pollUntilDone(): Promise<unknown> }>;
  }>;

  constructor(
    private readonly connectionString: string,
    private readonly sender: string,
    private readonly log?: Logger,
  ) {}

  private client() {
    this.clientPromise ??= import('@azure/communication-email').then(
      (m) => new m.EmailClient(this.connectionString),
    );
    return this.clientPromise;
  }

  async sendApproval(to: string, wave: string | null): Promise<boolean> {
    const waveLine = wave ? ` (${wave})` : '';
    try {
      const client = await this.client();
      // beginSend resolves once ACS has ACCEPTED the message — that is our
      // "sent" bar. Final delivery polling runs detached; a delivery-side
      // failure is logged, never surfaced to the approving admin.
      const poller = await client.beginSend({
        senderAddress: this.sender,
        content: {
          subject: `🎉 You're in — Noether v1 access approved${waveLine}`,
          plainText: [
            'gm,',
            '',
            `Your wallet just cleared the list — you're officially in Noether v1${waveLine}.`,
            '',
            'Getting in takes 30 seconds:',
            '',
            '  1. Go to https://noether.exchange',
            '  2. Hit "Already approved? Unlock with your wallet"',
            '  3. Connect the wallet you joined with and sign the challenge —',
            '     no fee, no transaction, just a signature.',
            '',
            "That's it. Perps on Stellar, fully on-chain: every order, match,",
            'and settlement.',
            '',
            "One heads-up: this is a guarded launch. Position and deposit caps",
            "start tight and open up wave by wave — that's deliberate. Trade sharp.",
            '',
            'See you on the other side,',
            '— The Noether team',
            '',
            'noether.exchange · x.com/Noetherdex',
          ].join('\n'),
          html: [
            '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">',
            '<p style="font-size:15px">gm,</p>',
            `<p style="font-size:15px">Your wallet just cleared the list — you're officially in <strong>Noether v1${waveLine}</strong>.</p>`,
            '<p style="font-size:15px;margin-bottom:6px">Getting in takes 30 seconds:</p>',
            '<ol style="font-size:15px;line-height:1.7;padding-left:20px;margin-top:0">',
            '<li>Go to <a href="https://noether.exchange" style="color:#b8860b">noether.exchange</a></li>',
            '<li>Hit <em>"Already approved? Unlock with your wallet"</em></li>',
            '<li>Connect the wallet you joined with and sign the challenge — no fee, no transaction, just a signature.</li>',
            '</ol>',
            '<p style="margin:24px 0"><a href="https://noether.exchange" style="background:#eab308;color:#000;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;display:inline-block">Unlock your access →</a></p>',
            "<p style=\"font-size:15px\">That's it. Perps on Stellar, fully on-chain: every order, match, and settlement.</p>",
            '<p style="font-size:13px;color:#555">One heads-up: this is a guarded launch — position and deposit caps start tight and open up wave by wave. That\'s deliberate. Trade sharp.</p>',
            '<p style="font-size:15px">See you on the other side,<br/>— The Noether team</p>',
            '<p style="font-size:12px;color:#999">noether.exchange · <a href="https://x.com/Noetherdex" style="color:#999">x.com/Noetherdex</a></p>',
            '</div>',
          ].join(''),
        },
        recipients: { to: [{ address: to }] },
      });
      void poller
        .pollUntilDone()
        .catch((err: unknown) => this.log?.warn({ err, to }, 'approval email delivery poll failed'));
      return true;
    } catch (err) {
      this.log?.warn({ err, to }, 'approval email send failed');
      return false;
    }
  }
}
