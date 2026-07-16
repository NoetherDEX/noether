import { Header } from '@/components/layout';

// B15: route-level skeleton so the server fetch never shows a blank page.
export default function VaultDetailLoading() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-12 pb-16">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8" aria-busy="true">
          <div className="h-4 w-24 bg-surface-2 rounded animate-pulse" />
          <div className="border-b border-border pb-8 space-y-3">
            <div className="h-8 w-64 bg-surface-2 rounded animate-pulse" />
            <div className="h-4 w-40 bg-surface-2 rounded animate-pulse" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-border bg-surface p-4 space-y-2">
                <div className="h-3 w-20 bg-surface-2 rounded animate-pulse" />
                <div className="h-6 w-28 bg-surface-2 rounded animate-pulse" />
              </div>
            ))}
          </div>
          <div className="h-64 rounded-lg border border-border bg-surface animate-pulse" />
        </div>
      </main>
    </div>
  );
}
