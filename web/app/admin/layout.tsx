import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false },
}

/**
 * The waitlist admin panel ships in every build but the ROUTE only exists
 * where NEXT_PUBLIC_ADMIN_ENABLED=1 is baked in (prod build values only) —
 * staging/testnet serve 404 here. Deliberately a build flag, not a branch
 * difference: staging merges into main, so deleting the page per-branch
 * would delete it from main on the next release merge.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_ADMIN_ENABLED !== '1') notFound()
  return children
}
