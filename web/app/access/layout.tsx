import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Access',
  robots: { index: false },
}

export default function AccessLayout({ children }: { children: React.ReactNode }) {
  return children
}
