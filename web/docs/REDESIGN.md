# UI Redesign Brief — "Quiet Terminal"

Goal: a modern, professional, dense trading interface. The current UI reads
dated: pure-black background, saturated gold fills, bubbly cards, decorative
glow. Target feel: precision instrument — calm surfaces, hairline borders,
monospaced numerals, one restrained accent.

## Design tokens (single source: app/globals.css + tailwind.config)
- Background layers (no pure black): `bg #0B0D10`, `surface #111419`,
  `surface-2 #171B21`, `surface-3 #1D222A` (hover).
- Hairlines: `border rgba(255,255,255,0.07)`, `border-strong 0.12`.
- Text: `fg #E8EAED`, `fg-muted #9BA1A8`, `fg-faint #646B73`.
- Brand accent (gold, used sparingly — CTAs, active states, brand marks;
  never large fills): keep `45 93% 47%` with near-black foreground.
- PnL: `long #16C784`, `short #EA3943` (+ 12% alpha tints for chips/rows).
- Radius: 8px cards, 6px controls. Shadows: none on dark; elevation via
  surface steps + hairlines only.
- Type: Inter (UI), JetBrains Mono + `tabular-nums` (ALL numerals: prices,
  sizes, balances, timestamps), Sora (display/landing only).
- Density: 4px grid; data rows 32–36px; table text 12–13px; section titles
  13px medium — no oversized headings in the app shell.

## Page plan (each = its own commit series, mock data where live data absent)
1. Foundation: tokens, tailwind config, base components (Button, Card, Input,
   Tabs, Table, Badge, Tooltip, Modal, Skeleton) restyle.
2. App shell: header (slim, 48–56px, inline nav + wallet), footer, page grid.
3. Trade screen (flagship): thin market-stats bar (pair selector, mark, 24h
   change/high/low, funding, OI) · chart dominant left · 320px order panel
   right (Market/Limit tabs, size, leverage slider, margin summary, honest
   depth/impact display — no fake order book) · bottom tabbed
   Positions/Orders/History full-width table.
4. Portfolio: net worth header, allocation, history (existing logic, new skin).
5. Earn (vault): deposit/withdraw card, pool stats, buffer/TVL transparency.
6. Leaderboard, Referrals, API keys: table + card reskins.
7. Landing: simplify — remove decorative glow effects, one strong hero,
   live-stats strip, product screenshots.
8. Final pass: web-interface-guidelines audit (skill) across all pages.

## Mock data strategy
`lib/mock/` provides typed fixtures (prices, positions, candles, leaderboard,
vault stats). `NEXT_PUBLIC_MOCK_MODE=1` short-circuits data hooks to fixtures
so the redesign is reviewable without a running stack; real wiring stays
intact and is the default.

## Acceptance criteria (Web Interface Guidelines — enforced)
tabular-nums on all numeric columns · focus-visible rings everywhere ·
aria-labels on icon buttons · prefers-reduced-motion honored · transform/
opacity-only animations · URL state for tabs/filters · inline form errors ·
truncation with min-w-0 · explicit image dimensions · no `transition: all` ·
44px touch targets on mobile · `color-scheme: dark`.

## Out of scope (this pass)
Contract wiring changes, new features, the mainnet pair-list cut, copy
rewrites beyond casing/consistency.
