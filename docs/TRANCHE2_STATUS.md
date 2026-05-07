# Tranche 2 — Implementation Status

This document tracks deliverable-level completion at the close of the
local build session. All artifacts are reviewed by typecheck + unit
tests; deployment-time work (testnet contract redeploys, GitHub
branch protection rules, npm/PyPI publishing) remains for the human
operator.

## Deliverable Status

### D1 — REST API for Programmatic Trading & SDK · ~98%

| Component | Status |
|-----------|--------|
| Indexer (event capture + libsql projections) | ✅ Phase 2, 10.10, 10.12, 11.6 |
| Public reads — markets, oracle, events | ✅ Phase 3 |
| Authentication — wallet challenge, Bearer keys, tiered rate limit | ✅ Phase 4 |
| Trading endpoints — 10 ops (open / close / limit / cancel / cross / stop-limit / trailing / SL / TP) | ✅ Phase 5 + 5.1 |
| TypeScript SDK — every endpoint + WsClient + executeTrade | ✅ Phase 6, 8, 11.8, 5.1.3 |
| Python SDK | ⏳ pending (P7) |
| OpenAPI spec auto-generated | ✅ via `/docs` (Fastify swagger) |

### D2 — WebSocket API for Real-Time Data · ✅ 100%

| Component | Status |
|-----------|--------|
| /v1/ws gateway — 4 channel families | ✅ Phase 8 |
| Live tailer + oracle ticker | ✅ Phase 8 |
| SDK WsClient (auto-reconnect, replay subscriptions) | ✅ Phase 8 |
| TypeScript example | ✅ `sdk-ts/examples/ws-ticker.ts` |
| Python example | ⏳ pending (with P7) |

### D3 — User-Created Vaults · ~90%

| Component | Status |
|-----------|--------|
| `vault_factory` Soroban contract | ✅ Phases 10.1–10.7 |
| Math layer (NAV, shares, profit-share, 5% invariant) | ✅ 11 unit tests |
| Initialize + create_vault + deposit + withdraw + claim + pause | ✅ 22 contract tests |
| WASM size verification | ✅ 17 195 bytes (26% of 64 KB cap) |
| Indexer migration + decoder + handler | ✅ Phases 10.10–10.12 |
| API marketplace + per-vault history endpoints | ✅ Phase 10.13 |
| SDK `client.vaults` sub-client | ✅ Phase 10.14 |
| Frontend `/vaults` marketplace + `/vaults/[id]` detail | ✅ Phases 10.16–10.17 |
| `leader_*` trading proxy (vault-as-trader → market) | ⏳ pending (P10.21) |
| Testnet deploy script + addresses written to contracts.json | ⏳ pending operator step |
| Frontend deposit / withdraw / leader-manage panels | ⏳ pending (need wallet integration) |

### D4 — Multi-Wallet & On-Chain Referral · ~90%

| Component | Status |
|-----------|--------|
| Multi-wallet (Freighter, Lobstr, xBull, Albedo, Ledger via Wallets Kit) | ✅ pre-existing T1 work |
| `referral` Soroban contract | ✅ Phases 11.1–11.4 (13 tests) |
| Indexer migration + decoder + handler | ✅ Phase 11.6 |
| API endpoints (`lookup`, `me`, `me/trades`, `me/claims`) | ✅ Phase 11.7 |
| SDK `client.referral` sub-client | ✅ Phase 11.8 |
| Frontend dashboard scaffold | ✅ Phase 11.9 |
| Market WASM optimisation + redeploy with referral hook | ⏳ pending operator step |
| `?ref=CODE` URL capture + auto-set_referrer prompt | ⏳ pending (small client-side helper) |

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
P10  ✅ Vault Factory contract + indexer/api/sdk/web (sub 14)
P11  ✅ Referral contract + indexer/api/sdk/web (sub 9)
P12  ⏳ Hardening + push + testnet deploy
```

## Testing Surface

- Rust: 33 (vault_factory) + 13 (referral) = **46 contract tests**
- TypeScript: 10 (indexer) + 37 (api) + 25 (sdk) = **72 off-chain tests**
- **118 total green tests** at session close.

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

- The vault-factory `leader_trade` proxy is not yet implemented;
  vaults can hold capital but the leader cannot trigger market
  positions on behalf of the pool until that ships. Tracked in
  contracts/vault_factory/README.md.
- The referral discount path requires the market contract to honour
  the on-chain `discount_bps` returned by `record_trade`. Until
  market is redeployed with that hook, the API gateway may apply the
  discount off-chain (rate-limit tier remains the volume-gate proxy).
- Frontend deposit / withdraw / leader-manage pages render but the
  signing flow needs the existing wallet adapter to be wired in (the
  `vaults/[id]/manage` route is not yet shipped in this session).
