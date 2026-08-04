import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Two request-level controls, evaluated in order:
 *
 * 1. LAUNCH GATE (pre-mainnet soft launch). When LAUNCH_GATE=1 — a RUNTIME
 *    env var on purpose, not NEXT_PUBLIC_*: flipping it is an env change +
 *    revision restart, no rebuild — the public sees only the /audit teaser.
 *    Holders of a valid signed cookie (issued by POST /api/access against
 *    ACCESS_CODES) get the full app. This gates the FRONTEND only; mainnet
 *    contracts are permissionless on-chain. Launch control, not security.
 *    Ops guide: docs/LAUNCH-GATE.md.
 *
 * 2. Interface-level geo-restriction (P6-4 / research 2.4 #8). Leveraged
 *    derivatives frontends geo-block restricted jurisdictions by IP — the
 *    2026 baseline (the CFTC's Deridex action established that "too small to
 *    notice" is not a defense). Blocks the trading surfaces only; a MAINNET
 *    compliance control, OFF by default, enabled explicitly with
 *    NEXT_PUBLIC_GEOBLOCK_ENABLED=1. Vercel populated request.geo;
 *    self-hosted behind Cloudflare the equivalent signal is the CF-IPCountry
 *    header (country-level only — the api gateway enforces the same list
 *    server-side as backstop, and the ToS carries the restricted-persons +
 *    no-VPN warranties).
 */

// US, Canada-Ontario, and OFAC-sanctioned jurisdictions.
const BLOCKED_COUNTRIES = new Set([
  'US', // United States
  'CU', // Cuba
  'IR', // Iran
  'KP', // North Korea
  'SY', // Syria
  'RU', // Russia
  'BY', // Belarus
]);
// Ontario is province-level; only the Vercel geo path exposes regions.
const BLOCKED_REGIONS = new Set(['CA-ON']);

const GUARDED_PREFIXES = ['/trade', '/vault', '/vaults', '/portfolio'];

const GATE_COOKIE = 'noether_access';
// Paths that stay reachable while gated: the teaser itself, the unlock flow,
// and the geoblock landing (kept for parity).
const GATE_OPEN_PATHS = new Set(['/audit', '/access', '/api/access', '/restricted']);

// TS 5.7+ types TextEncoder output as Uint8Array<ArrayBufferLike>, which the
// WebCrypto BufferSource signatures reject — hand over the exact ArrayBuffer.
function utf8Bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

async function hmacHex(secret: string, message: string): Promise<string> {
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

async function hasValidAccessCookie(request: NextRequest): Promise<boolean> {
  const secret = process.env.ACCESS_COOKIE_SECRET ?? '';
  const raw = request.cookies.get(GATE_COOKIE)?.value ?? '';
  const [expires, sig] = raw.split('.');
  if (!secret || !expires || !sig || !/^\d+$/.test(expires)) return false;
  if (Number(expires) * 1000 < Date.now()) return false;
  return (await hmacHex(secret, `noether-access.v1.${expires}`)) === sig;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (process.env.LAUNCH_GATE === '1' && !GATE_OPEN_PATHS.has(pathname)) {
    if (!(await hasValidAccessCookie(request))) {
      // API calls get a clean 401 instead of teaser HTML.
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'launch_gated' }, { status: 401 });
      }
      const url = request.nextUrl.clone();
      url.pathname = '/audit';
      url.search = '';
      return NextResponse.rewrite(url);
    }
  }

  // Opt-in geo-block: runs only when explicitly enabled (mainnet). Absent or
  // any value other than '1' → open, so testnet never blocks.
  if (process.env.NEXT_PUBLIC_GEOBLOCK_ENABLED !== '1') {
    return NextResponse.next();
  }

  const guarded = GUARDED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!guarded) return NextResponse.next();

  const geo = (request as unknown as { geo?: { country?: string; region?: string } }).geo;
  const country = geo?.country ?? request.headers.get('cf-ipcountry') ?? '';
  const region = country && geo?.region ? `${country}-${geo.region}` : '';

  if (BLOCKED_COUNTRIES.has(country) || BLOCKED_REGIONS.has(region)) {
    const url = request.nextUrl.clone();
    url.pathname = '/restricted';
    url.search = '';
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // The launch gate must see every page and api route; Next internals and
  // public files stay out. The geoblock narrows itself to GUARDED_PREFIXES
  // in code.
  //
  // Excluding `.*\..*` — any path containing a dot — let `/vaults/1.0`
  // through ungated: Number('1.0') is 1, so the route rendered vault 1 to
  // anyone. Only real static-asset extensions are excluded now, anchored at
  // the end of the path, so a dot inside a route segment no longer bypasses
  // the gate.
  matcher: [
    '/((?!_next/static|_next/image|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|bmp|css|js|mjs|map|txt|xml|json|webmanifest|woff|woff2|ttf|otf|eot|mp4|webm|pdf)$).*)',
  ],
};
