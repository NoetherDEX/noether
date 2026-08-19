/**
 * Launch-gate cookie crypto — ONE implementation shared by middleware.ts,
 * /api/access (code unlock, v1) and /api/access/wallet (approved-wallet
 * unlock, v2). Edge-safe: WebCrypto only.
 *
 * Formats:
 *   v1 (code):   "<expires>.<hmac>"            msg: noether-access.v1.<expires>
 *   v2 (wallet): "v2.<expires>.<G...>.<hmac>"  msg: noether-access.v2.<expires>.<G...>
 *
 * v1 cookies live 30 days (SCF-verifier codes). v2 cookies live 7 days so a
 * revoked wallet ages out of the SITE within a week — the gateway denies a
 * revoked wallet's API access instantly, and rotating ACCESS_COOKIE_SECRET
 * remains the nuclear option that invalidates everything at once.
 */

export const GATE_COOKIE = 'noether_access';
export const CODE_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
export const WALLET_COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60;

// TS 5.7+ types TextEncoder output as Uint8Array<ArrayBufferLike>, which the
// WebCrypto BufferSource signatures reject — hand over the exact ArrayBuffer.
function utf8Bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8Bytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, utf8Bytes(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time hex comparison — a plain === leaks a timing oracle. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function makeCodeCookieValue(secret: string): Promise<{ value: string; maxAge: number }> {
  const expires = Math.floor(Date.now() / 1000) + CODE_COOKIE_MAX_AGE_S;
  const sig = await hmacHex(secret, `noether-access.v1.${expires}`);
  return { value: `${expires}.${sig}`, maxAge: CODE_COOKIE_MAX_AGE_S };
}

export async function makeWalletCookieValue(
  secret: string,
  wallet: string,
): Promise<{ value: string; maxAge: number }> {
  const expires = Math.floor(Date.now() / 1000) + WALLET_COOKIE_MAX_AGE_S;
  const sig = await hmacHex(secret, `noether-access.v2.${expires}.${wallet}`);
  return { value: `v2.${expires}.${wallet}.${sig}`, maxAge: WALLET_COOKIE_MAX_AGE_S };
}

/** Validate either cookie generation. */
export async function verifyGateCookie(secret: string, raw: string): Promise<boolean> {
  if (!secret || !raw) return false;
  if (raw.startsWith('v2.')) {
    const [, expires, wallet, sig] = raw.split('.');
    if (!expires || !wallet || !sig || !/^\d+$/.test(expires)) return false;
    if (Number(expires) * 1000 < Date.now()) return false;
    const expected = await hmacHex(secret, `noether-access.v2.${expires}.${wallet}`);
    return timingSafeEqualHex(expected, sig);
  }
  const [expires, sig] = raw.split('.');
  if (!expires || !sig || !/^\d+$/.test(expires)) return false;
  if (Number(expires) * 1000 < Date.now()) return false;
  const expected = await hmacHex(secret, `noether-access.v1.${expires}`);
  return timingSafeEqualHex(expected, sig);
}
