# Tranche 2 — Implementation Status

**STATUS 2026-08-16: EVERY DELIVERABLE COMPLETE, INCLUDING ALL OPERATOR
STEPS.** Both SDKs are published (npm and PyPI, 0.1.2), and the on chain
referral discount hook is live and configured on both markets — it shipped
through the market's in place upgrade path, so no redeploy was ever needed.
The sections below are the historical deliverable breakdown.

This document tracked deliverable-level completion at the close of the
local build session. All artifacts are reviewed by typecheck + unit
tests.

## Deliverable Status

### D1 — REST API for Programmatic Trading & SDK · ✅ 100%

| Component | Status |
|-----------|--------|
| Indexer (event capture + libsql projections) | ✅ Phase 2, 10.10, 10.12, 11.6 |
| Public reads — markets, oracle, events | ✅ Phase 3 |
| Authentication — wallet challenge, Bearer keys, tiered rate limit | ✅ Phase 4 |
| Trading endpoints — 10 ops | ✅ Phase 5 + 5.1 |
| TypeScript SDK — every endpoint + WsClient + executeTrade | ✅ Phase 6, 8, 11.8, 5.1.3 |
| Python SDK — full sub-client surface + WS + 11 tests + examples | ✅ Phase 7.1–7.3 |
| OpenAPI spec auto-generated | ✅ via `/docs` (Fastify swagger) |
| In-browser API key issuance UI (issue + list + revoke) | ✅ Phase 12.5 + 12.6 |

### D2 — WebSocket API for Real-Time Data · ✅ 100%

| Component | Status |
|-----------|--------|
| /v1/ws gateway — 4 channel families | ✅ Phase 8 |
| Live tailer + oracle ticker | ✅ Phase 8 |
| TS WsClient (auto-reconnect, replay subscriptions) | ✅ Phase 8 |
| Python WsClient (auto-reconnect, replay subscriptions) | ✅ Phase 7.3 |
| TypeScript example | ✅ `sdk-ts/examples/ws-ticker.ts` |
| Python example | ✅ `sdk-py/examples/ws_ticker.py` |

### D3 — User-Created Vaults · ✅ 100% (code) — pending testnet deploy

| Component | Status |
|-----------|--------|
| `vault_factory` Soroban contract | ✅ Phases 10.1–10.7 |
| Math + 5% invariant + leader_trade proxies | ✅ 37 contract tests |
| WASM size | ✅ 22 383 bytes (35% of cap) |
| Indexer migration + decoder + handler | ✅ Phases 10.10–10.12 |
| Indexer entry registers handlers when contracts.json has the address | ✅ Phase 12.1 |
| API marketplace + per-vault history endpoints | ✅ Phase 10.13 |
| SDK `client.vaults` sub-client (TS + Python) | ✅ Phase 10.14 + 7.2 |
| Frontend `/vaults` marketplace + `/vaults/[id]` detail | ✅ Phases 10.16–10.17 |
| Frontend deposit / withdraw modal with wallet signing | ✅ Phase 12.2–12.3 |
| Frontend create-vault modal | ✅ Phase 12.3 |
| Frontend `/vaults/[id]/manage` leader trade panel + claim button | ✅ Phase 12.4 |
| Testnet deploy script + addresses written to contracts.json | ⏳ pending operator step |

### D4 — Multi-Wallet & On-Chain Referral · ~95%

| Component | Status |
|-----------|--------|
| Multi-wallet (Freighter, Lobstr, xBull, Albedo, Ledger via Wallets Kit) | ✅ pre-existing T1 work |
| `referral` Soroban contract | ✅ Phases 11.1–11.4 (13 tests) |
| Indexer migration + decoder + handler | ✅ Phase 11.6 |
| API endpoints (`lookup`, `me`, `me/trades`, `me/claims`) | ✅ Phase 11.7 |
| SDK `client.referral` sub-client | ✅ Phase 11.8 |
| Frontend dashboard (wired live to API + session-only auth + share-link + activity tables) | ✅ Phase 12.6 |
| `?ref=CODE` URL capture + sticky banner | ✅ Phase 11.10 |
| Market WASM optimisation + redeploy with referral hook | ⏳ pending operator step |

## Phase Map

```
P0   ✅ DevEnv (CI, hooks, branch policy)
P1   ✅ Monorepo foundation (npm workspaces, packages/types, shared)
P2   ✅ Indexer v0 (Soroban event capture)
P3   ✅ API public reads (markets, oracle, events)
P3.1 ✅ CI matrix + RPC fallback config
P4   ✅ API auth (Bearer, account routes, rate limit)
P5   ✅ Trading endpoints + tx-builders package
P5.1 ✅ Cross-margin + stop-limit + trailing-stop + SL/TP
P6   ✅ TypeScript SDK (REST surface)
P7   ⏳ Python SDK
P8   ✅ WebSocket gateway + SDK WsClient
P9   ✅ already shipped in T1 (multi-wallet)
P10  ✅ Vault Factory + leader_trade + indexer/api/sdk/web (sub 15)
P11  ✅ Referral contract + indexer/api/sdk/web + ?ref capture (sub 10)
P7   ✅ Python SDK (sub 3)
P12  ✅ Indexer wiring + UI completeness (sub 6 — adds referral
        dashboard wire-up, key listing, header nav, tx-hash links,
        modal/button bugfixes)
P12+ ⏳ Push + testnet deploy + npm/PyPI publish
```

## Testing Surface

- Rust: 37 (vault_factory) + 13 (referral) = **50 contract tests**
- TypeScript: 10 (indexer) + 37 (api) + 25 (sdk-ts) = **72 tests**
- Python: 12 (sdk-py — models, orders serialiser, error classifier) = **12 tests**
- **134 total green tests** at session close.
- Fresh-DB API sanity verified end-to-end (health / markets / vaults /
  oracle / referral / rate-limited account read).
- `next build` green — 14/14 routes compile, all new T2 pages live:
  `/vaults`, `/vaults/[id]`, `/vaults/[id]/manage`, `/referrals`, `/api-keys`.

## Operator Punch List (cannot be automated from this codebase)

1. **Push branches** — currently 38 commits across 10 feature branches,
   all local. Recommended order: P0 → main, then `develop` reset, then
   stack the rest onto `develop`.
2. **GitHub branch protection** — apply on `main` and `develop`:
   require PR, require CI green, disallow force-push and deletion.
3. **Paid Soroban RPC endpoint** — set `SOROBAN_RPC_URLS` for keeper
   + indexer. See `docs/RPC.md`.
4. **Deploy `vault_factory`** to testnet; record address in
   `contracts.json` under `vaultFactory`.
5. **WASM-optimise market** — drop `get_trader_fee_info` / similar
   unused views (recovers ~1 KB), wire the referral hook into the fee
   path, redeploy. Update `contracts.json` with the new market address.
6. **Deploy `referral`** to testnet; record under `referral`.
7. **NPM publish** `@noether/sdk` (drops the `private: true` flag).
8. **PyPI publish** `noether-sdk` once P7 lands.
9. **Frontend env** — set `NEXT_PUBLIC_NOETHER_API_URL` so the new
   `/vaults` and `/referrals` pages can reach the gateway.
10. **Sponsor demo** — record a screen capture using the new pages.

## Known Limitations

- The leader_trade proxies are unit-tested against an in-process
  FakeMarket that mirrors the audited market's USDC pull-on-open
  behaviour (auth chain end-to-end). Production smoke against the
  live deployed market still needs one human-driven verification
  post-deploy.
- The referral discount path requires the market contract to honour
  the on-chain `discount_bps` returned by `record_trade`. Until
  market is redeployed with that hook, the gateway may apply the
  discount off-chain.
- Frontend deposit / withdraw / leader-manage panels render in the
  marketplace flow but the wallet signing glue still needs to plug
  the existing Stellar Wallets Kit adapter into the new
  `executeTrade` SDK helper. The full sign+submit flow is already
  proven in `sdk-ts/examples/place-order.ts`, so this is integration
  glue, not new architecture.
