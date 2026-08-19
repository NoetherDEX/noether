import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { GATE_COOKIE, makeCodeCookieValue } from '@/lib/gate'

/**
 * Launch-gate unlock (code path, v1 cookie). Validates a submitted access
 * code against ACCESS_CODES (comma-separated sha256 hex digests — runtime
 * env, so codes rotate with an env update + revision restart, no rebuild)
 * and issues the signed cookie the middleware checks. Cookie crypto lives in
 * lib/gate.ts, shared with the approved-wallet unlock. See
 * docs/LAUNCH-GATE.md.
 */

// TS 5.7+ types TextEncoder output as Uint8Array<ArrayBufferLike>, which the
// WebCrypto BufferSource signatures reject — hand over the exact ArrayBuffer.
function utf8Bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8Bytes(value))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function POST(request: NextRequest) {
  const secret = process.env.ACCESS_COOKIE_SECRET ?? ''
  const codes = (process.env.ACCESS_CODES ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
  if (!secret || codes.length === 0) {
    return NextResponse.json({ error: 'gate_unconfigured' }, { status: 503 })
  }

  let code = ''
  try {
    const body = (await request.json()) as { code?: unknown }
    code = String(body.code ?? '')
  } catch {
    // fall through to missing_code
  }
  if (!code) {
    return NextResponse.json({ error: 'missing_code' }, { status: 400 })
  }

  const hash = await sha256Hex(code)
  if (!codes.includes(hash)) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 401 })
  }

  const { value, maxAge } = await makeCodeCookieValue(secret)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(GATE_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
  return res
}
