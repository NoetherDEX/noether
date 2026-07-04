# Noether Threat Model & Data-Flow (pre-audit)

Prepared for the SCF Audit Bank submission (P6-2). STRIDE per component, plus a
system data-flow diagram and trust boundaries. Companion to
`docs/AUDIT-2026-06.md` (the internal audit) and `SECURITY.md`. Reflects the
2026-07 hardening (Phase 1 contract sprint + Phase 2 router).

## System overview

Noether is a vault-as-counterparty perpetual-futures DEX. Traders open
leveraged positions against a shared LP vault; the vault profits when traders
lose and pays when they win. Prices come from Noeracle, a pull oracle (SCF #44)
whose signed attestations are relayed on-chain permissionlessly.

### Actors

| Actor | Trust | Capability |
|---|---|---|
| Trader | untrusted | open/close/liquidate-self via wallet signature; supplies price attestations to the router |
| LP | untrusted | deposit/withdraw USDC ↔ NOE |
| Keeper | semi-trusted (liveness only) | pushes oracle prices, triggers liquidations + order execution + funding; cannot move user funds |
| Admin (`noether_admin`) | trusted | pause/unpause/upgrade, config (fee split, OI caps), issuer of USDC+NOE |
| Noeracle publisher | trusted for price integrity | signs `(feed, price, conf, ts)` off-chain |

### Trust boundaries

```
   ┌─────────────────────── off-chain (untrusted transport) ───────────────────────┐
   │  Web app ──build tx──┐        Noeracle API (SSE + REST) ──signed attestation──┐ │
   │  SDK (ts/py) ────────┤                                                        │ │
   │  Keeper (Railway) ───┤                                                        │ │
   └──────────────────────┼────────────────────────────────────────────────────────┘
                          │ tx (wallet-signed)                    │ price push
   ═══════════ TRUST BOUNDARY: Soroban require_auth ═══════════════════════════════
                          ▼                                        ▼
   ┌── on-chain ─────────────────────────────────────────────────────────────────┐
   │  noether_router ──relay signed price (allowlisted pubkeys, P2-4)──► Noeracle │
   │       │ same-tx invoke                                              (get/set) │
   │       ▼                                    ┌──── noeracle_shim (SEP-40 read) ─┘
   │  market ──settle/reserve/sync_exposure──► vault (LP funds, NOE)               │
   │       │                                        ▲                              │
   │       └── oracle read via shim ────────────────┘                              │
   │  vault_factory (v1.1), referral (v1.1)                                        │
   └──────────────────────────────────────────────────────────────────────────────┘
        API gateway + indexer read the chain / project events (read-side only;
        strictly non-custodial — never hold keys that move user funds).
```

### Data-flow (one trade)

1. Web/SDK fetches a fresh signed attestation from Noeracle.
2. Wallet signs a `router.open_with_price(...)` tx (trader = source account).
3. Router verifies the attestation's publisher keys are allowlisted + within
   sanity bounds, relays it into Noeracle's persistent slot, then invokes
   `market.open_position` in the same tx.
4. Market reads the just-stored price via `oracle_adapter role → noeracle_shim`,
   checks staleness + deviation band, reserves the max payout in the vault
   (rejects past OI caps), pulls collateral, persists the position, pushes the
   asset's unrealized PnL to the vault.
5. Indexer captures the emitted events → libsql projections → API/WS consumers.

## STRIDE by component

### Market contract
- **Spoofing:** every entry point calls `require_auth` on the trader; keeper
  reward paid to the caller. ✔
- **Tampering:** price trusted from the oracle chain — mitigated by the router
  publisher allowlist (P2-4) + market deviation band vs last-good price + 60s
  staleness (P1-5, #81). Residual: **O-1** (Noeracle write path not yet
  publisher-authenticated) is the primary open risk → mainnet gate.
- **Repudiation:** all state transitions emit events; indexer archives raw XDR.
- **Info disclosure:** n/a (public chain state).
- **DoS:** global `AllPositions`/`AllOrders` Vec is an O(n) scaling ceiling
  (M-5, medium at guarded-launch scale; paginated buckets scheduled Phase 5).
  Pause is admin-only.
- **Elevation:** pause/unpause/upgrade/config are `require_admin`. Liquidations
  are intentionally exempt from the pause check (incident containment).

### Vault
- **Tampering/Elevation:** settle/reserve/sync_exposure/receive_loss are
  market-only (`require_auth` on the stored market address). Admin-only pause,
  upgrade, fee/cap setters.
- **Solvency (core threat):** real payout reservation caps aggregate + per-asset
  OI vs AUM (P1-3); a winner's close can never hard-revert (payout capped +
  shortfall recorded, P1-3/P1-8); losses credited only on receipt; LP
  withdrawals cannot undercut reserved payouts; NAV includes open PnL (P1-4) so
  LP front-running is closed (V-2). Residual: no insurance buffer yet (Phase 5).

### Noether router
- **Spoofing/Tampering:** publisher allowlist rejects foreign/empty keys;
  coarse per-asset price bounds reject garbage regardless of signature.
  Relaying stays permissionless by design (Pyth model). Upgrade admin-gated.

### Oracle (Noeracle + shim)
- **Tampering:** **O-1 open** — the persistent write entrypoint verifies the
  ed25519 sig against a caller-supplied pubkey with no registered-publisher /
  monotonic-round / staleness guard. Hardening (2-of-3 publisher quorum,
  strictly-increasing rounds) is the documented hard mainnet gate. Shim is a
  minimal SEP-40 translator; read-time staleness surfaced to the web.

### API gateway / indexer (read-side, non-custodial)
- **Spoofing:** wallet-challenge auth issues HMAC-peppered bearer keys;
  constant-time compare; production fails closed on unset pepper/allowlist/CORS.
- **Tampering:** parameterized SQL throughout; indexer idempotent + dead-letters
  poison events; cursor CAS prevents double-writers.
- **DoS:** tiered per-key + per-IP rate limiting (trustProxy); WS connection
  caps.
- **Elevation:** strictly non-custodial — the gateway holds no key that can move
  user funds; trader is hard-bound to the authenticated key owner.

### Key management (repo-wide)
- **Elevation (SEC-3, open):** one admin EOA is USDC+NOE issuer + every contract
  admin + deploy key + Vercel faucet hot key. Migration to 2-of-3 classic
  multisig + dedicated faucet/keeper keys is P3-8, a mainnet gate.

## Residual risks gating mainnet (from the audit)

1. **O-1** — Noeracle write-path authentication (in the Noeracle repo).
2. **SEC-3** — admin key ceremony (2-of-3 multisig, key separation).
3. **Insurance buffer + partial liquidation + ADL** (Phase 5) before 25x.
4. Independent audit (SCF Audit Bank) covering all seven contracts + Noeracle.

Everything else in the June audit's critical set (M-1 pause/upgrade, M-2
deviation, M-3 cross SL/TP, M-4 OI caps, V-2 NAV, O-2 router allowlist, O-3
liquidation price, K-1 keeper liveness) was remediated in the 2026-07 sprint —
see `TASKS.md` Phases 1–2.
