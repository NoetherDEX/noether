import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Interface-level geo-restriction (P6-4 / research 2.4 #8). Leveraged
 * derivatives frontends geo-block restricted jurisdictions by IP — the 2026
 * baseline (the CFTC's Deridex action established that "too small to notice"
 * is not a defense). This blocks the trading surfaces only; marketing, docs,
 * faucet and the referral pages stay open.
 *
 * Enforcement is best-effort at the edge (Vercel provides request.geo); the
 * API gateway applies the same restriction server-side, and the ToS carries
 * the restricted-persons + no-VPN warranties.
 *
 * This is a MAINNET compliance control, so it is OFF by default — testnet
 * (both prod + staging) offers only valueless test tokens, and IP geo is
 * imperfect enough to false-block legitimate testers. Enable it explicitly
 * at the mainnet cutover with NEXT_PUBLIC_GEOBLOCK_ENABLED=1 (see
 * docs/ORACLE_CUTOVER_RUNBOOK.md / the mainnet checklist).
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
// Ontario is province-level; Vercel exposes region via geo.region.
const BLOCKED_REGIONS = new Set(['CA-ON']);

const GUARDED_PREFIXES = ['/trade', '/vault', '/vaults', '/portfolio'];

export function middleware(request: NextRequest): NextResponse {
  // Opt-in: geo-block runs only when explicitly enabled (mainnet). Absent or
  // any value other than '1' → open, so testnet never blocks.
  if (process.env.NEXT_PUBLIC_GEOBLOCK_ENABLED !== '1') {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const guarded = GUARDED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!guarded) return NextResponse.next();

  const geo = (request as unknown as { geo?: { country?: string; region?: string } }).geo;
  const country = geo?.country ?? '';
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
  // Run only on the guarded surfaces (and skip static assets / api).
  matcher: ['/trade/:path*', '/vault/:path*', '/vaults/:path*', '/portfolio/:path*'],
};
