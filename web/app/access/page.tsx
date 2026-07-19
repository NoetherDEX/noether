'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * Unlock page for the pre-mainnet launch gate. Reached via magic link
 * (/access?code=XXX — auto-submits) or the teaser easter egg. A valid code
 * sets the signed access cookie server-side (POST /api/access) and the full
 * app opens.
 */
function AccessForm() {
  const params = useSearchParams()
  const [code, setCode] = useState('')
  const [state, setState] = useState<'idle' | 'checking' | 'invalid' | 'error'>('idle')
  const autoTried = useRef(false)

  const submit = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setState('checking')
    try {
      const res = await fetch('/api/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      })
      if (res.ok) {
        // Full navigation (not router.push) so the new cookie is present on
        // the next middleware pass.
        window.location.href = '/trade'
        return
      }
      setState(res.status === 401 ? 'invalid' : 'error')
    } catch {
      setState('error')
    }
  }

  useEffect(() => {
    const fromLink = params.get('code')
    if (fromLink && !autoTried.current) {
      autoTried.current = true
      setCode(fromLink)
      void submit(fromLink)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit(code)
      }}
      className="flex w-full max-w-sm flex-col items-stretch gap-3"
    >
      <input
        type="password"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Access code"
        autoFocus
        autoComplete="off"
        className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm text-white outline-none transition focus:border-[#eab308]/60"
      />
      <button
        type="submit"
        disabled={state === 'checking'}
        className="rounded-xl bg-[#eab308] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[#facc15] disabled:opacity-50"
      >
        {state === 'checking' ? 'Checking…' : 'Enter'}
      </button>
      {state === 'invalid' && (
        <p className="text-center text-sm text-red-400">Invalid code.</p>
      )}
      {state === 'error' && (
        <p className="text-center text-sm text-red-400">
          Something went wrong — try again.
        </p>
      )}
    </form>
  )
}

export default function AccessPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6">
      <p
        className="text-xl font-semibold tracking-[0.3em] text-white/90"
        style={{ fontFamily: 'var(--font-sora)' }}
      >
        NOETHER
      </p>
      <Suspense fallback={null}>
        <AccessForm />
      </Suspense>
    </main>
  )
}
