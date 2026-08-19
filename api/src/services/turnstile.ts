/**
 * Cloudflare Turnstile server-side verification for the public waitlist
 * join. Injected as a dep so tests stub it; when no secret is configured
 * the route 503s (fail loud) rather than silently skipping the check.
 *
 * Dev/test note: Cloudflare publishes always-pass test keys
 * (secret 1x0000000000000000000000000000000AA) for local runs.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const FETCH_TIMEOUT_MS = 8_000;

export interface TurnstileVerifier {
  readonly enabled: boolean;
  verify(token: string, remoteIp?: string): Promise<boolean>;
}

export class CloudflareTurnstile implements TurnstileVerifier {
  readonly enabled = true;

  constructor(private readonly secret: string) {}

  async verify(token: string, remoteIp?: string): Promise<boolean> {
    if (!token) return false;
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    try {
      const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      // Network failure verifying a bot-check: fail closed — a join can be
      // retried, a bot flood cannot be un-admitted.
      return false;
    }
  }
}

export class DisabledTurnstile implements TurnstileVerifier {
  readonly enabled = false;

  async verify(): Promise<boolean> {
    return false;
  }
}
