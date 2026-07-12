'use client';

import { FadeIn } from './animations';
import realPosts from './x-posts.json';

const X_PROFILE = 'https://x.com/Noetherdex';

/* Real posts come from x-posts.json — synced with `node
   scripts/sync-x-posts.mjs` (add new post IDs there; text, date, and
   media are downloaded and baked in statically, so embeds cost zero
   runtime JS). Curated announcements below fill the grid until every
   slot is a real post. */
const CURATED = [
  {
    id: 'curated-vaults',
    url: X_PROFILE,
    name: 'Noether',
    handle: '@Noetherdex',
    text: 'Copy-trading vaults are open: back a proven leader with USDC or run a vault of your own. Deposits, trades, and PnL splits all settle through the vault factory.',
    dateLabel: 'Vaults',
    image: '/media/news-vaults.jpg',
  },
  {
    id: 'curated-execution',
    url: X_PROFILE,
    name: 'Noether',
    handle: '@Noetherdex',
    text: 'Noeracle streaming marks: ~500ms oracle updates drive execution, funding, and liquidation. The chart quotes exactly what the contract settles.',
    dateLabel: 'Execution',
    image: '/media/news-execution.jpg',
  },
];

const CARDS = [...realPosts, ...CURATED].slice(0, Math.max(realPosts.length, 3));

function XLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function ProtocolNewsSection() {
  return (
    <section className="bg-background border-t border-border px-6 sm:px-14 py-24">
      <div className="flex items-baseline justify-between gap-6 mb-12">
        <FadeIn>
          <h2 className="font-display font-normal tracking-[-0.01em] leading-none text-foreground text-[clamp(2.5rem,5.5vw,4.5rem)]">
            Protocol <em className="italic text-primary">news</em>
          </h2>
        </FadeIn>
        <a
          href={X_PROFILE}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 font-mono text-xs text-faint hover:text-primary transition-colors"
        >
          @Noetherdex ↗
        </a>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {CARDS.map((post, i) => (
          <FadeIn key={post.id} delay={Math.min(i * 0.06, 0.18)} className="h-full">
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col rounded-lg border border-border bg-surface p-6 transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              {/* Post header */}
              <div className="flex items-center gap-3 mb-5">
                {/* eslint-disable-next-line @next/next/no-img-element -- small static brand avatar */}
                <img
                  src={(post as { avatar?: string }).avatar ?? '/media/x/avatar.jpg'}
                  alt=""
                  width="36"
                  height="36"
                  className="rounded-full border border-border"
                  aria-hidden="true"
                />
                <div className="min-w-0 leading-tight">
                  <p className="text-sm font-semibold text-foreground">{post.name}</p>
                  <p className="font-mono text-[11px] text-faint">{post.handle}</p>
                </div>
                <span className="ml-auto text-faint group-hover:text-foreground transition-colors">
                  <XLogo />
                </span>
              </div>

              {/* Post body */}
              <p className="text-[15px] leading-relaxed text-foreground/90 whitespace-pre-line line-clamp-[8]">
                {post.text}
              </p>

              {/* Post media */}
              {post.image && (
                <div className="mt-5 rounded-md overflow-hidden border border-border bg-surface-2 aspect-[16/9]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static card media in a fixed aspect box */}
                  <img
                    src={post.image}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                    aria-hidden="true"
                  />
                </div>
              )}

              {/* Post footer */}
              <div className="mt-auto pt-6">
                <div className="pt-4 border-t border-border flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-faint">
                    {post.dateLabel}
                  </span>
                  <span className="font-mono text-[11px] text-faint group-hover:text-primary transition-colors">
                    View on X ↗
                  </span>
                </div>
              </div>
            </a>
          </FadeIn>
        ))}
      </div>
    </section>
  );
}
