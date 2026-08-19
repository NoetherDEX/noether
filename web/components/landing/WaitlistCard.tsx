'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWalletStore } from '@/lib/store/walletStore';
import {
  joinWaitlist,
  requestAccessChallenge,
  unlockWithWallet,
  waitlistStatus,
  type WaitlistSegment,
} from '@/lib/api/waitlist';

/**
 * Waitlist + approved-wallet unlock island on the /audit teaser.
 *
 * Bundle discipline: the teaser must stay dependency-light, so everything
 * heavy is deferred — ConnectButton (and with it the stellar-sdk graph)
 * loads only when the user reaches the unlock step, and the challenge
 * signer is imported inside the click handler.
 */

const ConnectButton = dynamic(
  () => import('@/components/wallet/ConnectButton').then((m) => m.ConnectButton),
  { ssr: false, loading: () => <p className="text-sm text-white/40">Loading wallet options…</p> },
);

// Cloudflare's public always-pass sitekey keeps local dev working without a
// real widget; production requires the env var.
const SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ??
  (process.env.NODE_ENV === 'production' ? '' : '1x00000000000000000000AA');

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
          theme?: string;
        },
      ) => string;
      reset: (id?: string) => void;
    };
  }
}

const G_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

type Phase = 'form' | 'submitting' | 'pending' | 'approved';

export function WaitlistCard() {
  const connected = useWalletStore((s) => s.address);
  const [wallet, setWallet] = useState('');
  const [email, setEmail] = useState('');
  const [segment, setSegment] = useState<'' | WaitlistSegment>('');
  const [attest, setAttest] = useState(false);
  const [token, setToken] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [message, setMessage] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);

  // Mount the Turnstile widget once the script is available.
  useEffect(() => {
    if (!SITE_KEY || rendered.current) return;
    const tryRender = () => {
      if (rendered.current || !turnstileRef.current || !window.turnstile) return;
      rendered.current = true;
      window.turnstile.render(turnstileRef.current, {
        sitekey: SITE_KEY,
        theme: 'dark',
        callback: setToken,
        'expired-callback': () => setToken(''),
        'error-callback': () => setToken(''),
      });
    };
    if (window.turnstile) {
      tryRender();
      return;
    }
    const existing = document.getElementById('cf-turnstile-script');
    if (!existing) {
      const script = document.createElement('script');
      script.id = 'cf-turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = tryRender;
      document.head.appendChild(script);
    } else {
      existing.addEventListener('load', tryRender, { once: true });
    }
  }, []);

  // A connected wallet pre-fills the field and quietly checks status.
  useEffect(() => {
    if (!connected) return;
    setWallet((w) => w || connected);
    waitlistStatus(connected)
      .then((s) => {
        if (s === 'approved') setPhase('approved');
        else if (s === 'pending') setPhase('pending');
      })
      .catch(() => {});
  }, [connected]);

  const submit = useCallback(async () => {
    setMessage('');
    const w = wallet.trim();
    if (!G_ADDRESS_RE.test(w)) {
      setMessage('Enter a valid Stellar wallet address (G…).');
      return;
    }
    if (!attest) {
      setMessage('Please accept the terms and confirm eligibility.');
      return;
    }
    if (!token) {
      setMessage('Please complete the human check.');
      return;
    }
    setPhase('submitting');
    try {
      const { status } = await joinWaitlist({
        wallet: w,
        email: email.trim() || undefined,
        segment: segment || undefined,
        turnstileToken: token,
      });
      setPhase(status === 'approved' ? 'approved' : 'pending');
    } catch (err) {
      setPhase('form');
      setMessage(err instanceof Error ? err.message : 'Something went wrong — try again.');
      window.turnstile?.reset();
      setToken('');
    }
  }, [wallet, email, segment, attest, token]);

  const unlock = useCallback(async () => {
    const address = connected ?? wallet.trim();
    if (!connected) {
      setShowConnect(true);
      return;
    }
    setUnlocking(true);
    setMessage('');
    try {
      const challenge = await requestAccessChallenge(address);
      const { signChallengeWithWallet } = await import('@/lib/api/sign');
      const signature = await signChallengeWithWallet(challenge, address);
      await unlockWithWallet({ address, challenge, signature });
      // Full navigation so the fresh cookie is present on the next
      // middleware pass (mirrors the /access code flow).
      window.location.href = '/trade';
    } catch (err) {
      setUnlocking(false);
      setMessage(
        err instanceof Error && err.message === 'not_approved'
          ? 'This wallet is not approved yet.'
          : err instanceof Error
            ? err.message
            : 'Unlock failed — try again.',
      );
    }
  }, [connected, wallet]);

  if (!SITE_KEY) return null; // waitlist not configured for this deployment

  const inputCls =
    'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-[#eab308]/60';

  return (
    <div className="mt-10 w-full max-w-md text-left">
      {phase === 'pending' && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-6 text-center">
          <p className="text-sm font-semibold text-white">You&apos;re on the waitlist.</p>
          <p className="mt-2 text-sm leading-relaxed text-white/60">
            We approve wallets in waves — you&apos;ll get an email when yours is in
            (if you shared one). Meanwhile, trading is open on{' '}
            <a href="https://testnet.noether.exchange/trade" className="text-[#eab308] hover:underline">
              testnet
            </a>
            .
          </p>
        </div>
      )}

      {phase === 'approved' && (
        <div className="rounded-xl border border-[#eab308]/40 bg-[#eab308]/10 px-5 py-6 text-center">
          <p className="text-sm font-semibold text-white">This wallet is approved.</p>
          <p className="mt-2 text-sm text-white/60">
            Sign a one-time challenge with it to enter.
          </p>
          {showConnect && !connected ? (
            <div className="mt-4 flex justify-center">
              <ConnectButton />
            </div>
          ) : (
            <button
              onClick={unlock}
              disabled={unlocking}
              className="mt-4 rounded-xl bg-[#eab308] px-6 py-3 text-sm font-semibold text-black hover:bg-[#facc15] disabled:opacity-50"
            >
              {unlocking ? 'Waiting for wallet…' : connected ? 'Sign & enter' : 'Connect wallet'}
            </button>
          )}
          {message && <p className="mt-3 text-sm text-red-400">{message}</p>}
        </div>
      )}

      {(phase === 'form' || phase === 'submitting') && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-3"
        >
          <p className="text-center text-sm font-semibold text-white">Join the mainnet waitlist</p>
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value.trim())}
            placeholder="Stellar wallet address (G…)"
            spellCheck={false}
            className={inputCls}
          />
          {connected && wallet !== connected && (
            <button
              type="button"
              onClick={() => setWallet(connected)}
              className="text-xs text-[#eab308] hover:underline"
            >
              Use connected wallet {connected.slice(0, 4)}…{connected.slice(-4)}
            </button>
          )}
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (optional — we'll tell you when you're in)"
            type="email"
            className={inputCls}
          />
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value as '' | WaitlistSegment)}
            className={`${inputCls} appearance-none ${segment ? 'text-white' : 'text-white/30'}`}
          >
            <option value="">I plan to… (optional)</option>
            <option value="trader">Trade</option>
            <option value="lp">Provide liquidity</option>
            <option value="both">Both</option>
          </select>
          <label className="flex items-start gap-2 text-xs leading-relaxed text-white/50">
            <input
              type="checkbox"
              checked={attest}
              onChange={(e) => setAttest(e.target.checked)}
              className="mt-0.5 accent-[#eab308]"
            />
            <span>
              I accept the{' '}
              <a href="/terms" target="_blank" className="text-[#eab308] hover:underline">
                terms
              </a>{' '}
              and confirm I am not a resident of a restricted jurisdiction.
            </span>
          </label>
          <div ref={turnstileRef} className="flex justify-center" />
          {message && <p className="text-sm text-red-400">{message}</p>}
          <button
            type="submit"
            disabled={phase === 'submitting'}
            className="w-full rounded-xl bg-[#eab308] px-6 py-3 text-sm font-semibold text-black hover:bg-[#facc15] disabled:opacity-50"
          >
            {phase === 'submitting' ? 'Joining…' : 'Join waitlist'}
          </button>
          <p className="text-center text-xs text-white/40">
            Already approved?{' '}
            <button
              type="button"
              onClick={() => setPhase('approved')}
              className="text-[#eab308] hover:underline"
            >
              Unlock with your wallet
            </button>
          </p>
        </form>
      )}
    </div>
  );
}
