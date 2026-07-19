'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Wordmark on the audit teaser — and the easter egg: five quick taps within
 * three seconds opens the /access unlock page.
 */
export function TeaserLogo() {
  const router = useRouter()
  const clicks = useRef<number[]>([])

  const onClick = () => {
    const now = Date.now()
    clicks.current = [...clicks.current.filter((t) => now - t < 3000), now]
    if (clicks.current.length >= 5) {
      clicks.current = []
      router.push('/access')
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Noether"
      className="select-none text-2xl font-bold tracking-[0.3em] text-white/90"
      style={{ fontFamily: 'var(--font-sora)' }}
    >
      NOETHER
    </button>
  )
}
