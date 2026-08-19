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
          subject: `You're approved for Noether v1${waveLine}`,
          plainText: [
            `Your wallet has been approved for Noether v1${waveLine}.`,
            '',
            'Head to https://noether.exchange, choose "Already approved?",',
            'connect the wallet you joined with, and sign the unlock challenge.',
            '',
            '— Noether',
          ].join('\n'),
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
