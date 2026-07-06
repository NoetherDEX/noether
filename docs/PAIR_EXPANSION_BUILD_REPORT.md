# Pair Expansion Build Report — 3 → 14 Noeracle Pairs

**Date:** 2026-07-04 · **Branch:** `feature/noeracle-more-pairs` (PR #33) · **Network:** testnet

Noether went from 3 trading pairs (BTC, ETH, XLM) to **14** — every feed the
[Noeracle](https://noeracle.org) attestation service publishes, except
USDC/USD (our settlement asset; a USDC-USD perp would be a degenerate market
pinned at ~$1.00).

**New pairs:** SOL, XRP, ADA, BNB, TRX, HYPE, DOGE, ZEC, LINK, BCH, LTC.

---

## Does adding a pair change the smart contracts?

**Short answer: yes, but only two small tables — and after this PR, never a
redeploy again.**

The protocol has **one multi-asset market contract**, not one market per
pair. Every entry point takes an `asset: Symbol` argument, and positions
store their symbol. So adding a pair needs **no new market deployment, no
market/vault code change, and no storage migration**. What must change:

| # | What | Where | Why |
|---|------|-------|-----|
| 1 | Symbol → oracle-tag row | `contracts/noether_common/src/assets.rs` (`PAIR_TAGS`) | The shim (read path) and router (write path) must derive the same 8-byte Noeracle slot key, e.g. `SOL` → `SOLUSD\0\0` |
| 2 | Price sanity band | `contracts/noether_router/src/lib.rs` (`price_bounds`) | Coarse backstop that rejects a wildly wrong attestation regardless of signatures |

Both used to be hardcoded if/else chains; they are now **table-driven**, so a
future pair is literally one added row in each table.

**Shipping the change:** the tag map is compiled into the `noeracle_shim` and
`noether_router` WASMs, so both must be rebuilt and re-shipped. The router
already had an in-place `upgrade()`; the shim did **not** — which forced a
redeploy to a new address and, because the market has no oracle setter, a
re-pointing problem. This PR **adds `upgrade()` to the shim**, so from now on
a pair addition is: edit 2 table rows → `upgrade()` the shim and router in
place → done. No address churn, no market touch, no env changes.

Everything else picks the list up automatically: the API, indexer, and SDK
read `packages/shared/src/assets.ts::SUPPORTED_ASSETS`; the indexer is keyed
by contract id and reads the asset from event payloads.

---

## Phase 1 — Discovery

- Queried `https://api.noeracle.org/v1/latest`: **15 live feeds**, each a
  5-source median with an Ed25519-signed attestation (publisher
  `8f8650ca…4e17a`).
- Cross-checked Binance (our chart/candle source): every new symbol has a
  `*USDT` market **except HYPE** → HYPE is protocol-supported (contracts,
  oracle, keeper, API) but hidden from the web UI until a non-Binance candle
  source exists.

## Phase 2 — Implementation (commit `fcf0be1`)

**Contracts**
- `noether_common/src/assets.rs` — table-driven `PAIR_TAGS` (14 rows) +
  stronger tests (tag-shape invariant; unknown symbol now tested with `PEPE`).
- `noether_router/src/lib.rs` — table-driven `price_bounds` with bands per
  pair (e.g. SOL $1–$100k, DOGE $0.001–$100).
- `noeracle_shim/src/lib.rs` — new admin-gated `upgrade()` entry point.

**Off-chain**
- `packages/shared/src/assets.ts` — `SUPPORTED_ASSETS` → 14 (flows to
  api/indexer/sdk automatically).
- `web` — asset selectors (grid + dropdown), Binance candle map (13 UI pairs,
  no HYPE), and a new `priceDecimals(asset)` helper replacing 22 scattered
  `asset === 'XLM' ? 4 : 2` ternaries so sub-dollar assets (XLM, XRP, ADA,
  TRX, DOGE) render at 4dp.
- `scripts/keeper/src/config.ts` — publish-path sanity bands for all 14,
  mirroring the router bounds.

## Phase 3 — Quality gates

| Gate | Result |
|------|--------|
| `cargo test --workspace` (contracts) | **168 passed, 0 failed** (8 crates) |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `npm run typecheck` (all workspaces) + web `tsc` | clean |
| `npm test` (api/indexer/packages suites) | all passing |

One legitimate test break was fixed: the shim's "unknown symbol" test used
DOGE as its unknown fixture — DOGE is now a real pair.

## Phase 4 — Deployment (testnet, blue-green staging)

Because the previously deployed staging stack predates the audit sprint, a
**fresh green stack** was stood up (new throwaway staging keys, friendbot
funded). Two infra snags fixed along the way: local `stellar` CLI 22 couldn't
speak protocol-27 testnet (upgraded to 27.0.0), and `market.wasm` had skipped
optimization (raw rustc output contains reference-types opcodes the VM
rejects — re-optimizing fixed it and shrank it 73.7 KB → 65.2 KB).

| Contract | Address |
|----------|---------|
| noeracle_shim (14-pair) | `CASUDHE4HYT676A4LXQVVTHDXMU7R5HXNUYTJA7XYD6RAPILQPJWDGDT` |
| market | `CCPF34A3R2XZRDT4TEMN24XS5V7OWY3ZMF6BVZVYTPR4LMEEAZNWEOF7` |
| vault | `CAOUYQIM5VYLTE7YQIURH4OHZWLL5U4SYDZOQPUSN456WCRKGVJMWUEK` |
| noether_router | `CCIDOFOS4MOQVVQI6ES3RN7LK2SLD225H3TP6NVBV5F42IKEZWCBWOP3` |
| NOE token (green) | `CCBJXZUNXNWGDG6WTLGKPPNF3INHWDFD6ODRQS524J4QD5GFTJIVMLV3` |

Wiring: vault ↔ market, market → shim → Noeracle (`CAYIP67U…`), router
initialized with the Noeracle publisher allowlist, 1B NOE pre-minted to the
vault. Recorded in `contracts.staging.json`.

## Phase 5 — On-chain verification (all 14 pairs)

For **every** pair: fetched a fresh signed attestation → published on-chain
via `update_ed25519_persistent` → read back through `shim.lastprice` →
simulated `market.sync_asset_pnl` (the full market → shim → Noeracle path,
including staleness checks). All 14 passed:

| Pair | lastprice (7-dec) | ≈ USD | sync_asset_pnl |
|------|-------------------|-------|----------------|
| BTC | 632426555556 | $63,242.66 | ✓ |
| ETH | 17920977778 | $1,792.10 | ✓ |
| XLM | 2105349 | $0.2105 | ✓ |
| SOL | 818877778 | $81.89 | ✓ |
| XRP | 11721844 | $1.1722 | ✓ |
| ADA | 1949580 | $0.1950 | ✓ |
| BNB | 5760866667 | $576.09 | ✓ |
| TRX | 3261593 | $0.3262 | ✓ |
| HYPE | 698236667 | $69.82 | ✓ |
| DOGE | 787956 | $0.0788 | ✓ |
| ZEC | 4718712500 | $471.87 | ✓ |
| LINK | 80938944 | $8.09 | ✓ |
| BCH | 2342311111 | $234.23 | ✓ |
| LTC | 452197900 | $45.22 | ✓ |

Negative check: an unsupported symbol (`PEPE`/pre-publish `DOGE`) correctly
fails with `InvalidPrice`/`OracleUnavailable`.

## Phase 6 — staging → main promotion

- Verified with `git merge-tree`: **zero conflicts**; `main` had no commits
  absent from `staging`, so the merged tree is byte-identical to the already
  CI-green staging HEAD `e2eb410`.
- **PR #34 merged** → `main` is now at `cf46700` (69 commits promoted: the
  whole audit sprint, Phases 0–6).

---

## Outstanding / operator steps

1. **Review & merge PR #33** (this pair-expansion branch → staging) — kept
   for human review; after it lands, promote staging → main again.
2. **Funded trade test on a new pair** — needs testnet USDC (faucet) for a
   trader + vault liquidity; all read paths verified, but no live position
   was opened on the green stack.
3. **Keeper + web env cutover** — point the staging keeper and the Vercel
   preview at the green addresses (`contracts.staging.json`); the keeper then
   publishes all 14 pairs continuously.
4. **Production stack** — still runs pre-audit WASM with the 3-pair shim; the
   production cutover (blue-green, same procedure as Phase 4) is a separate
   deliberate step.
5. **HYPE in the web UI** — needs a non-Binance candle source (e.g. Bybit or
   OKX behind the existing proxy route).
6. **Noeracle testnet `oracle_v0` caveat** (pre-existing, unchanged): it does
   not enforce publisher/staleness/monotonic-round on-chain; the router's
   allowlist + bounds are the current mitigations, mainnet blocker tracked in
   `docs/noeracle-feature-requests.md`.
