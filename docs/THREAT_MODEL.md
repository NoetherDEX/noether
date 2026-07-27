# Noether — STRIDE Threat Model & Data-Flow

**Prepared for:** Soroban Security Audit Bank submission
**Project:** Noether — decentralized perpetual futures exchange on Soroban (SCF #41)
**Date:** 2026-07-19
**Version:** 2.0 (supersedes the 2026-07-04 pre-Batch-1 revision)
**Companions:** `docs/AUDIT-2026-06.md` (87-finding internal review), `SECURITY.md` (disclosure policy), `KNOWN_ISSUES.md`

---

## 0. Audit scope

Rust/Soroban workspace at `contracts/`. Six deployed WASM contracts plus one shared library crate.

| Crate | Deployed | Role | Functional LOC (excl. tests) | Tests |
|---|---|---|---|---|
| `market` | ✔ | Trading engine: positions, orders, cross/isolated margin, funding, partial + full liquidation, ADL | 4,911 | 149 |
| `vault` | ✔ | LP pool, NOE share token, PnL settlement, solvency reservations, insurance buffer, bad-debt ledger | 1,863 | 45 |
| `vault_factory` | ✔ | User-created copy-trading vaults (leader proxies, follower shares) | 1,494 | 54 |
| `noether_router` | ✔ | Atomic verify-then-trade: relay signed price + call market in one tx | 774 | 29 |
| `noeracle_shim` | ✔ | SEP-40-style read adapter, market → oracle | 339 | 13 |
| `referral` | ✔ | On-chain referral: code registry, accrual, claims | 521 | 13 |
| `noether_common` | lib | Shared types, fixed-point math, error registry | 1,053 | 26 |
| **Total in scope** | | | **10,955** | **329** |

Workspace total is **346 tests** (`cargo test --workspace`); the 17 not listed above belong to `risk`, an **undeployed** experimental crate excluded from scope (per-asset risk config was folded into `noether_common::types` instead — see L0-12).

**Adjacent, separately maintained:** the price source is **Noeracle** (SCF #44, same team, separate repo, ~710 functional LOC, ~13KB WASM). Noether's security depends on it directly. We request it be scoped in, or scoped separately — see §6.

**Freeze protocol.** The audited surface is a **tagged commit** (`audit-freeze-1`). Nothing lands on that surface after the tag; a CI freeze-guard enforces it. Rebuilt WASM hashes from the tag will be verified byte-equal to the mainnet-deployed hashes.

---

## 1. System overview

Noether is a **vault-as-counterparty** perpetual futures DEX. There is no order-book matching engine and no peer-to-peer matching: an LP pool (USDC) takes the other side of every trade at oracle price. The vault profits when traders lose and pays when traders win. Every order, fill, funding application, liquidation, and settlement is an on-chain Soroban transaction.

This design concentrates risk in one place: **vault solvency**. The dominant threat is not theft of a single user's funds — it is the pool being drained, or being unable to pay a winning trader, through price manipulation, mispriced risk limits, or an accounting error in the settlement waterfall. §4 treats this separately because standard STRIDE categories under-serve it.

### 1.1 Actors and trust

| Actor | Trust level | Capability | Cannot |
|---|---|---|---|
| **Trader** | untrusted | open/close/partial-close positions, place & cancel orders, manage collateral, self-liquidate; supplies price attestations to the router | move another account's funds; write price without a valid publisher signature |
| **LP** | untrusted | deposit/withdraw USDC ↔ NOE shares | withdraw below the reserved-payout floor; exit inside the 30-min cooldown |
| **Vault leader** (factory) | untrusted | trade a follower-funded vault via proxies; claim profit share above HWM | withdraw follower principal; act on another vault's positions (ownership maps) |
| **Keeper** | semi-trusted — **liveness only** | push oracle prices, trigger liquidations/ADL, execute orders, apply funding, reconcile factory state | move user funds; alter config; forge prices (signature-verified upstream) |
| **Noeracle publisher** | trusted for **price integrity** | sign `(feed, price, conf, timestamp)` off-chain | write directly on-chain (relaying is permissionless) |
| **Admin** (`noether_admin`) | **trusted — highest residual risk** | pause/unpause, upgrade, all risk & fee config, USDC+NOE issuance | bypass the 48h recovery timelock; force-close user positions (deliberately not built) |

Two deliberate design choices worth auditor attention:

1. **Relaying is permissionless** (Pyth model). Anyone may submit a *publisher-signed* attestation. Authority rests in the signature, not the caller.
2. **There is no admin force-close.** An admin entrypoint that closes user positions was explicitly rejected as contradicting the pause/recovery design and the key-custody model. Incident containment goes through the pause state machine (§3.1) instead.

### 1.2 Trust boundaries

```
┌───────────────────── OFF-CHAIN (untrusted transport) ─────────────────────┐
│  Web app (Next.js) ──build tx──┐                                          │
│  SDKs (TypeScript, Python) ────┤   Noeracle API (SSE + REST)              │
│  Keeper bot (Azure) ───────────┤        │ signed attestations             │
│  API gateway + indexer ────────┘        │ (read-side only, non-custodial) │
└──────────────────────┬──────────────────┼─────────────────────────────────┘
                       │ wallet-signed tx │ price relay (permissionless)
═══════ TRUST BOUNDARY: Soroban require_auth + ed25519 verification ════════
                       ▼                  ▼
┌─────────────────────── ON-CHAIN (Soroban) ────────────────────────────────┐
│  noether_router ── relay signed price (publisher allowlist + price        │
│       │            bands) ──► Noeracle ◄── noeracle_shim (SEP-40 read)    │
│       │ same-tx invoke                                    ▲               │
│       ▼                                                   │ price read    │
│  market ──settle / reserve / sync_exposure / draw_buffer──┴──► vault      │
│       │                                                    (LP funds,    │
│       │                                                     NOE, buffer)  │
│  vault_factory ──leader proxies──┘        referral ──accrual/claims       │
└───────────────────────────────────────────────────────────────────────────┘
```

The API gateway and indexer sit **outside** the trust boundary and are **strictly non-custodial**: they hold no key capable of moving user funds. Compromising them yields bad *reads*, not stolen funds. This is an explicit invariant, not an accident of the current deployment.

### 1.3 Data flow — one trade

1. Web/SDK fetches a fresh signed attestation from Noeracle (SSE stream, on-chain shim as fallback).
2. Trader's wallet signs `router.open_with_price(...)`; trader is the tx source account.
3. **Router** checks the attestation's publisher keys against its allowlist and the price against coarse per-asset bands (`PriceBand`, storage-overridable with a compiled fallback), then relays it into Noeracle's persistent slot.
4. **Router** invokes `market.open_position` in the **same transaction** — so the market's 60s staleness check can never trip on a trade the user just paid for.
5. **Market** reads the just-written price through the shim, re-checks staleness plus a deviation band against last-good price (#81), applies per-asset risk limits (leverage cap, min size), nets against opposite same-asset legs, reserves the **maximum payout** in the vault, pulls collateral, persists the position, and pushes the asset's unrealized PnL to the vault.
6. **Vault** rejects the reservation if it breaches aggregate OI, per-asset OI, or the directional skew cap.
7. Events emit; the **indexer** captures them into Postgres projections; API/WS consumers read from there.

---

## 2. STRIDE — on-chain components

### 2.1 Market contract

**Spoofing.** Every user entrypoint calls `require_auth` on the trader address. Keeper rewards pay to the caller, so impersonating a keeper gains nothing beyond the bounty the caller earns by doing the work. Config and lifecycle entrypoints are `require_admin`.

**Tampering.** The market trusts price from the oracle chain. Defence in depth, all on-chain:
- router publisher allowlist + coarse per-asset price bands (rejects garbage regardless of signature validity);
- market-side deviation band vs. last-good price, 60s staleness (#81);
- **lenient settlement clamp** — non-strict reads clamp into ±`lenient_clamp_bps` of the pre-update last-good price, but only inside a 10× staleness window, so a long halt still passes through and closes never brick;
- **acceptable-price bounds** on open and close (#87, `0` = unbounded) — user-supplied slippage protection, inverse check for closes;
- **slippage band gating** — stop-loss, trailing-stop, and TP-market orders fill at oracle price (protective orders must be *guaranteed*); limit-entry, stop-limit phase 1, and take-limit keep band-and-cancel semantics.

Residual: see §6 (O-1).

**Repudiation.** Every state transition emits an event; the indexer archives raw XDR alongside decoded projections. Event formats are versioned in-repo and decoders branch on arity where payloads changed (e.g. `funding_applied` 2-tuple legacy vs 4-tuple per-asset).

**Information disclosure.** Not applicable — all state is public chain state by design. There is no private order flow and no off-chain matching to leak.

**Denial of service.**
- Global `AllPositions` / `AllOrders` vectors are O(n)-scanned. This is a **known scaling ceiling** (M-5), now **hard-capped on-chain** (2026-07-20): 1,000 positions / 2,000 pending orders market-wide, 32 positions / 128 orders per trader, 512 active cross-margin accounts. Inserts at capacity reject with #82; closes, liquidations, and in-place updates are never gated. Paginated buckets remain the post-launch fix. **Auditors: please validate the chosen caps against the per-transaction resource budget.**
- Pause is admin-only and modal (§3.1); liquidation and ADL are deliberately **pause-exempt** so containment cannot itself create insolvency.
- Per-asset halt (`set_asset_halt`, #92) gates only the four risk-*increasing* sites — opens and non-reduce-only placements. Closing, liquidating, cancelling, and removing collateral stay open.
- Cross-margin operations bound leg counts (`MAX_NET_LEGS`, `MAX_OPEN_PER_VAULT`).

**Elevation of privilege.** Pause/unpause/upgrade/all config are `require_admin`. The pause state machine has a **72-hour auto-degrade**: full-freeze (mode 2) decays to halt-open (mode 1) on the next write, so an absent or compromised admin cannot trap user funds indefinitely.

### 2.2 Vault contract

**Tampering / Elevation.** `settle_pnl`, `reserve_for_position`, `sync_exposure`, `receive_loss`, `draw_buffer`, `pay_bounty`, `pay_from_buffer`, and `route_protocol_fee` are **market-only** — enforced via `require_auth` on the stored market address. Admin-only: pause, upgrade, fee split, caps, buffer target, cooldown.

**Availability / exit rights.** Withdraw is **not** pause-gated — LPs can always exit a paused vault, subject only to the reserved-payout floor (#40) and a 30-minute post-deposit cooldown (#93). Deposit *is* pause-gated. `emergency_withdraw` was **deleted** and replaced with a **48-hour timelocked recovery**: `init_recovery` (one-shot address binding) → `propose` → `execute` (paused-only, capped at balance, single fixed destination), with `unpause` auto-cancelling any pending proposal.

**Front-running (V-2, closed).** NAV includes open position PnL, so an LP cannot deposit ahead of a known-losing trader's settlement to capture it.

Solvency is treated in §4.

### 2.3 Vault factory (copy-trading vaults)

**Tampering / fund isolation (V-1, closed).** The original `sync_total_usdc` set a vault's balance from the *whole factory's* USDC balance — a cross-vault drain. It was **deleted**. Every leader operation now credits a **measured balance delta** (`bal_before`/`bal_after` around the market invoke) to its own vault only.

**Elevation.** `PositionVault` / `OrderVault` ownership maps gate every leader close/cancel/protective-order proxy (#16) — a leader cannot act on another vault's position. `create_vault` is allowlist- and count-gated (#20).

**Valuation integrity (V-4).** `full_nav` = liquid balance + Σ position equity + Σ pending order collateral. Deposits, withdrawals, and profit-share claims all price at full NAV; withdrawals cap payout at the **liquid** portion (#17) rather than haircutting other followers. Valuation **fails closed** (#18) if any position is unreadable — including a stale position closed at the market — freezing deposits/withdrawals until a permissionless `reconcile_position` / `reconcile_order` call resolves it.

**Reconciliation design note (worth auditor scrutiny).** A global-surplus attribution scheme was rejected as racy across vaults. Instead the **market** records each full close's trader proceeds in temporary storage; the factory reads the exact amount. Known edge: a *partially* liquidated vault position survives and is not `reconcile_position`-eligible — documented, and we would like this specifically reviewed.

### 2.4 Noether router

**Spoofing / Tampering.** Publisher allowlist rejects foreign or empty keys. Coarse per-asset price bands reject implausible values regardless of signature validity. Relaying stays permissionless by design. Upgrade is admin-gated. New trading pairs need no router redeploy (storage override with compiled fallback).

**Constraint auditors should know:** Soroban's 10-parameter limit was hit while threading acceptable-price through router open/close. That threading is deferred into the Noeracle attestation-struct restructure. Users currently get acceptable-price protection on the direct market path.

### 2.5 Noeracle shim

Minimal SEP-40 translator. No trust decisions of its own; read-time staleness is surfaced upward and rendered in the UI rather than silently defaulting.

### 2.6 Referral

Code registry, accrual, and claims are on-chain. **Current gap:** the market does not yet honour `discount_bps`; the gateway applies the discount off-chain, so contract events and user-visible price diverge slightly for referred wallets. On-chain activation (fee ordering: gross fee → referral accrual → protocol cut → buffer routing → LP share) is the last contract item before freeze.

---

## 3. STRIDE — operational & off-chain

### 3.1 Pause / incident containment

Three modes: `0` live · `1` halt-open (no new risk; closing, liquidation, ADL all continue) · `2` full freeze (auto-degrades to `1` after 72h). `cancel_order` is ungated in all modes. Liquidation and ADL are pause-exempt throughout — an operator cannot create insolvency by freezing the system mid-crash.

### 3.2 Keeper

**Spoofing/Elevation:** the keeper holds a dedicated identity that can only *trigger* permissionless work; it holds no fund-moving authority. **DoS/liveness:** keeper downtime delays liquidations and funding but cannot corrupt state; ADL and liquidation are permissionless, so any third party can perform them for the bounty. Keeper failure is a **liveness** risk, priced as such. Bankruptcy liquidations carry a minimum bounty (`min_liq_bounty`, default 5 USDC, paid from the buffer) so under-collateralised positions stay economically worth liquidating.

### 3.3 API gateway & indexer (read-side, non-custodial)

**Spoofing:** wallet-challenge auth (signed XDR challenge) issues bearer keys hashed at rest with an HMAC pepper; constant-time comparison; production **fails closed** on unset pepper, allowlist, or CORS origin. **Tampering:** parameterized SQL throughout; the indexer is idempotent, dead-letters poison events, and uses cursor compare-and-swap to prevent double-writers. **DoS:** tiered per-key and per-IP rate limiting, WS connection caps. **Elevation:** the authenticated key owner is hard-bound to the `trader` field — a key cannot act for another address. The gateway holds **no key that can move user funds**.

### 3.4 Key management — the largest open risk

**SEC-3 (open).** A single admin EOA is currently: USDC + NOE issuer, admin of every contract, deploy key, *and* the faucet hot key. Compromise is catastrophic and total.

Mitigation before mainnet: 2-of-3 classic multisig for the admin role, with the faucet and keeper split onto dedicated keys. A staging drill for the migration is written and pending execution. **This is a hard mainnet gate.** We would welcome the auditors' view on the ceremony and on whether the timelocked-recovery design adequately bounds admin power in the interim.

---

## 4. The solvency waterfall (primary threat surface)

For a vault-as-counterparty perp DEX this is the crown jewel. Requesting focused review.

**Invariant:** *a winning trader's close must never hard-revert, and LP funds must never be paid out below the reserved-payout floor.*

Order of defence, outermost first:

1. **Reservation at open.** Full maximum payout is reserved in the vault before a position exists. Rejected past aggregate OI cap, per-asset OI cap (`min(bps × AUM, absolute)`), or the directional **skew cap** (#89) — with skew-*reducing* opens always allowed through.
2. **Per-asset risk config.** Leverage cap, maintenance margin, and min size per asset, epoch-gated: before the first `set_asset_risk` the legacy global config applies (so pre-existing positions are unaffected); after it, risk-increasing operations **fail closed** (#88) for unconfigured assets while risk-reducing ones are grandfathered to legacy MM.
3. **Funding.** Per-asset cumulative index, SIP-279 velocity driven by **time-weighted** skew, clamped to ±`funding_clamp_bps`/hour. Applied lazily per position at close/liquidation.
4. **Partial liquidation.** Penalty = `min(1% of closed notional, remaining)`, split 50/50 keeper/buffer, remainder refunded to the trader. The penalty is capped at the tranche's equity share, which makes it **health-ratio-invariant** at flat maintenance margin — it can only *improve* account health under the risk ladder.
5. **Cross-account liquidation.** Three branches (bankrupt / close-out / staged), positions sorted ascending by unrealized PnL, stopping at 1.5× maintenance margin, with a grace timestamp (#83) between staged rounds. A signed running pool makes the residual **order-independent**.
6. **Insurance buffer.** Fed by a protocol fee stream: `route_protocol_fee` fills the buffer up to `BufferTargetBps` (default 10% of reserved payout) and overflows to treasury. LP share is credited exactly `fee − cut` — never reduced by buffer filling.
7. **Bad-debt ledger.** `draw_buffer` covers shortfalls accounting-only (NOE share price stays flat while covered); `record_bad_debt` fires at all three bankruptcy paths. Cross-account loss transfers cap at **account** funds so bystander collateral is never touched.
8. **Shortfall queue.** If the buffer is dry, the owed amount is recorded in `ShortfallOwed` against a disjoint `ShortfallReserve`, amortized from 50% of inflows, claimable by the trader via `claim_shortfall` (not pause-gated). The LP floor includes the reserve. **A winner's close caps the payout and records the shortfall rather than reverting** — the invariant above.
9. **ADL (auto-deleveraging).** `check_adl_trigger` compares coverage against payable unrealized PnL using exposure aggregates, with 1.25×/1.5× hysteresis and an automatic flip on shortfall. `adl_close` is **permissionless and pause-exempt** (#84/#85); opens are gated while ADL is active (#82).

**Questions we'd most like answered:** Is the reservation model conservative under correlated multi-asset moves? Can the ADL trigger oscillate inside the hysteresis band? Is the shortfall amortizer fair across claimants under partial recovery?

---

## 5. Security practices to date

- **Internal audit** — `docs/AUDIT-2026-06.md`: 87 findings with file:line evidence, followed by a completed remediation sprint. Critical set (pause/upgrade, deviation band, cross SL/TP, OI caps, NAV front-running, router allowlist, liquidation price, keeper liveness) all remediated.
- **Tests** — 346 workspace contract tests; ~114 API + ~49 indexer + ~39 SDK tests off-chain.
- **Live arity guard** — a CI job simulates every transaction builder against the deployed market so ABI drift between contracts and off-chain builders fails the build. This caught two latent classes of bug where builders constructed transactions that would revert on-chain.
- **CI** — pinned Rust toolchain; `cargo clippy --workspace --all-targets -- -D warnings`; full workspace tests; conventional-commit enforcement.
- **Reproducible builds** — `Cargo.lock` tracked; optimized WASM well inside the 128KB limit (market ~102.8KB, vault ~58.4KB, factory ~52.9KB, router ~41.5KB).
- **Disclosure policy** — `SECURITY.md`: published reward bands, 72h acknowledgement SLA, SEAL 911 escalation path.
- **Self-service tooling** — `cargo scout-audit` run and findings dispositioned prior to freeze (results submitted alongside this document).

---

## 6. Residual risks gating mainnet

| # | Risk | Status | Owner |
|---|---|---|---|
| **O-1** | Noeracle persistent write path is not publisher-authenticated — signature verified against a *caller-supplied* pubkey, with no registered-publisher, quorum, or monotonic-round guard. **Anyone can currently set a price.** | M-of-N quorum + median, price ring buffer/TWAP, and an `upgrade()` entrypoint are implemented on a branch, pending review + deploy. **Hard mainnet gate.** | Noeracle repo |
| **SEC-3** | Single admin EOA is issuer + every contract admin + deploy key + faucet hot key. | 2-of-3 multisig migration + key separation; staging drill written. **Hard mainnet gate.** | Noether |
| **L1-18** | Referral discount applied off-chain at the gateway, not honoured by the market. | Last contract item before freeze. | Noether |
| **M-5** | O(n) global position/order vectors — scaling ceiling, not a correctness bug. | **Mitigated 2026-07-20:** on-chain growth caps (1,000/2,000 market-wide, 32/128 per trader, 512 cross accounts; closes/liquidations never gated). Paginated buckets still planned post-launch. | Noether |
| — | Partial-liquidation edge for factory-owned positions is not `reconcile_position`-eligible. | Documented; review requested. | Noether |

**On Noeracle scoping.** Noether's price integrity reduces entirely to Noeracle's. O-1 is our single most severe open finding and it lives in the other repo. Noeracle is itself an oracle — an infrastructure contract in the program's priority list. We would prefer it in scope alongside `market` and `vault`; if it needs a separate application we will file one, but the two should be reviewed against each other regardless, since the router↔oracle boundary is where a compromise would be monetized.

---

## 7. Assumptions and out of scope

**Assumed sound:** Soroban host semantics and storage TTL behaviour; the Stellar Asset Contract for USDC and NOE; ed25519 verification in the host; wallet-side signing (Freighter, LOBSTR via Stellar Wallets Kit).

**Out of scope for this engagement:** the Next.js frontend, the API gateway and indexer (non-custodial read-side — a compromise yields bad reads, not stolen funds), the keeper bot (liveness only, no fund authority), and the undeployed `risk` crate.

**In scope but low-severity by construction:** `noeracle_shim` (translator, no trust decisions) and `referral` (no custody of trader collateral).
