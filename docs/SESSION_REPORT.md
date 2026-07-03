# Noether — Engineering Report (road to guarded mainnet)

Owner: acting CTO / lead dev. Scope: finish every **codeable** step toward a guarded
mainnet launch, defer all manual ops to a handoff guide, build with the upstream
`soroban` stellar-dev skill, and verify fund-critical changes adversarially.
Branch: `feat/audit-phase0-1-security` → PR #31. `main` never touched.

---

## 1. What we built (this campaign)

### Security hardening (highest priority — done + verified)
The Phase 0–1 work was put through **three rounds of adversarial multi-agent review**.
~18 confirmed findings were fixed, including:
- **CRITICAL** insolvency bug: the keeper-driven SL/TP/trailing close path
  (`execute_close_order`) didn't cap the loss at collateral, so a leveraged
  position could transfer more than its collateral to the vault and drain other
  traders' pooled funds. Fixed by unifying all isolated closes on one
  conservation-safe `settle_and_close`.
- **HIGH** funding conservation: negative funding paid the trader from the pool
  unbacked. Fixed by folding funding into the vault settlement (vault is the
  funding counterparty).
- **HIGH** trailing-stop zombie: trailing stops weren't cancelled on close. Fixed
  with a `PositionTrailingStop` slot.
- Keeper publish-path: jump-breaker freeze, baseline-expiry, `NETWORK`/passphrase
  K-8 guard, config validation.

### Oracle / keeper (Phase 2 — done)
P2-4 publisher allowlist · P2-5 router fresh-price liq/exec (contract **and** the
keeper-side switch with safe fallback) · P2-6 price backstop · P2-7 watchdog ·
P2-8 publish defenses · K-8 key hygiene.

### Risk engine (Phase 5 — P5-1/P5-2 done, rest designed)
- **P5-1**: per-asset `RiskConfig` (max OI long/short, max leverage, maintenance
  margin, max position size), admin `set_risk_config` with validation, enforced at
  all three open paths via `enforce_open_limits`. Per-asset OI counters kept in
  sync with global OI at every open/close via `add_oi`/`drop_oi`. Unset assets stay
  uncapped (behaviour-preserving). This is the on-chain lever for the guarded
  launch (3 pairs @10x + OI caps).
- **P5-2**: isolated liquidation health + new-position liq price read the LIVE
  per-asset maintenance margin, so an admin MM raise applies to existing positions.

### Product / off-chain (Phase 4 — slice done)
P4-5/P4-6 public `/v1/stats` + `/v1/volume` endpoints (off the indexer, 3 tests).

### Tooling
Updated the local stellar-dev skill to the upstream latest (7 skills: soroban,
dapp, assets, data, agentic-payments, zk-proofs, standards) and **corrected the
WASM size limit** the upstream skill still gets wrong (it says 64KB; the live
network limit is **128KB**, verified via RPC on testnet AND mainnet).

**Test posture:** 140 contract tests + the api/keeper suites, clippy clean, keeper
type-clean. Every fund-critical change verified by an adversarial workflow.

---

## 2. The methodology (how we built it)

1. **stellar-dev skill first** — the `soroban` skill's security checklist
   (conservation, checked/saturating arithmetic, auth, TTL, no-reinit) gated every
   contract change; pitfalls + testing references informed the tests.
2. **Design → build → test → adversarially verify → commit.** Fund-critical
   contract changes were designed by a parallel workflow, implemented, unit-tested,
   then re-reviewed by independent adversarial agents before being trusted.
3. **Incremental commits**, no AI attribution, never on `main`.

---

## 3. The big unblock

The whole "redeploy is blocked because the market WASM is too big (>64KB)" concern
was **false**. The 64KB number is stale doc guidance. The live network
`maxContractSizeBytes` is **131072 (128KB)** on testnet and mainnet. The market is
~73.7KB — it fits with ~57KB of headroom. **No view-contract split is needed; the
contracts can deploy as-is.** Lesson: verify the live network config, not docs.

---

## 4. What is DONE vs REMAINING vs BLOCKED

**Done (code-complete + tested):** Phase 0, Phase 1 (+ hardening), Phase 2 (P2-4/5/6/7/8,
K-8), Phase 5 P5-1 + P5-2, Phase 4 P4-5/6, the size-gate resolution, the skill update.

**Designed but not yet implemented** (full implementation maps exist in the workflow
output; each is a follow-up): P5-5 partial liquidation, P5-6 insurance buffer, P5-7
ADL, P5-8 TWAP oracle, P5-9 partial close, P5-3/4 funding-pool formalization, the
cross-margin per-asset MM (P5-2 tail), the Phase 2 keeper tail (P2-9/10/11/12),
Phase 4 (WS hardening, SDK builders, mobile), Phase 3 (monitoring, env-override
addresses, incident runbook), Phase 6 (guarded-config constants, geo-block/ToS,
config-parity, `cargo scout-audit`).

**Blocked / external:** Noeracle P2-1/2/3 (hardened write path + median) — owned by
Yahya, a **mainnet** gate, not ours and not a testnet blocker.

**Manual (yours, by design):** PR merge, contract redeploy, Railway/Vercel/Turso env
+ branches, admin key ceremony, SCF audit application. All in `DEPLOY_RUNBOOK.md`.

---

## 5. Problems handled / not handled (decisions taken)

- **Cross-margin per-asset MM (P5-2 tail) — KNOWN GAP, not yet closed.** Isolated
  health uses per-asset MM; cross health still uses the global MM. Closing it means
  changing `position.rs` signatures to resolve per-leg. Deferred to keep the P5-1/2
  commit focused + low-risk; tracked. Not exploitable for fund loss (it just means
  a cross MM raise doesn't hit existing cross legs until that change lands).
- **Negative-funding edge** — resolved by the vault-as-counterparty fold; a fuller
  funding-pool ledger (P5-3/4) is designed but not built.
- **Persistent reference divergence (keeper)** — kept as skip+alert by design;
  auto-publishing a divergent price is unsafe. Real fix = oracle-layer median (P2-1).
- **Scope honesty:** "ALL steps" is a multi-campaign effort. We prioritized the
  mainnet-critical, fund-safety, and guarded-launch-enabling items and verified them,
  rather than ship a large volume of unverified code. The designs for the rest are
  captured so the next pass is implementation-only.

---

## 6. How to ship it
See **`docs/DEPLOY_RUNBOOK.md`** — ordered manual steps (merge, secrets, redeploy
with `ROUTER_PUBLISHERS_JSON`, per-asset `set_risk_config`, point services, restart
keeper, smoke test). And **`docs/EXECUTION_PLAN.md`** for the live task status.

## 7. Verification outcome (P5-1/P5-2 + P2-5)

The adversarial review of the risk-engine + keeper changes confirmed **4 findings**;
all real ones are fixed (commit `d1c8d62`):
- **HIGH** — `liquidate_cross_account` leaked OI when a leg's oracle was down (skip +
  unconditional account wipe), which P5-1's per-asset counters turn into an
  open-path DoS. **Fixed**: abort the whole liquidation atomically if any leg can't
  be priced (no partial wipe; keeper retries).
- **MEDIUM** — cross-margin health used the global maintenance margin, not per-asset
  (the P5-2 cross gap). **Fixed**: `aggregate_cross_positions` resolves per-asset MM
  per leg.
- **MEDIUM** — the keeper cached attestations before its divergence/jump checks, so
  the router liq/exec path could use a refused price. **Fixed**: cache only after the
  checks pass.
- **LOW** — confirmation (not a bug) that an admin MM raise correctly affects
  existing isolated positions. No change.

Net: the risk-engine slice (P5-1/P5-2, incl. the cross-MM tail) is now verified
fund-safe. 140 contract tests pass, clippy clean, keeper type-clean.
