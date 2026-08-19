import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { GATE_COOKIE, makeWalletCookieValue } from '@/lib/gate'
import { apiBase } from '@/lib/api/base'

/**
 * Launch-gate unlock (approved-wallet path, v2 cookie). The browser signs a
 * one-shot gateway challenge with the wallet and posts it here; THIS route
 * (never the browser) forwards it to the gateway's /v1/access/verify — the
 * challenge is one-shot, so exactly one consumer may spend it — and on an
 * approved verdict issues the 7-day v2 cookie the middleware checks.
 */

interface UnlockBody {
  address?: unknown
  challenge?: unknown
  signature?: unknown
}

export async function POST(request: NextRequest) {
  const secret = process.env.ACCESS_COOKIE_SECRET ?? ''
  if (!secret) {
    return NextResponse.json({ error: 'gate_unconfigured' }, { status: 503 })
  }

  let address = ''
  let challenge = ''
  let signature = ''
  try {
    const body = (await request.json()) as UnlockBody
    address = String(body.address ?? '')
    challenge = String(body.challenge ?? '')
    signature = String(body.signature ?? '')
  } catch {
    // fall through to bad_request
  }
  if (!address || !challenge || !signature) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  let verdict: Response
  try {
    verdict = await fetch(`${apiBase()}/v1/access/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, challenge, signature }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return NextResponse.json({ error: 'gateway_unreachable' }, { status: 502 })
  }

  if (!verdict.ok) {
    const detail = (await verdict.json().catch(() => ({}))) as { error?: string }
    return NextResponse.json(
      { error: detail.error ?? 'not_approved' },
      { status: verdict.status === 401 ? 401 : 403 },
    )
  }

  const { wave } = (await verdict.json().catch(() => ({}))) as { wave?: string | null }
  const { value, maxAge } = await makeWalletCookieValue(secret, address)
  const res = NextResponse.json({ ok: true, wave: wave ?? null })
  res.cookies.set(GATE_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
  return res
}
