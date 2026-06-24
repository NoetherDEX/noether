# Noether — Remaining-Work Execution Plan (CTO-owned, build-then-handoff)

Goal: finish every **codeable** step toward a guarded mainnet launch, with all manual
ops (PR merge, contract redeploy, Railway/Vercel/Turso) deferred to a single handoff
guide at the end. Built with the `soroban` stellar-dev skill (security checklist +
testing patterns) and adversarially verified via workflows. `main` is never touched —
all work on `feat/audit-phase0-1-security` → PR #31.

Legend: ✅ done · 🔨 in progress · ⬜ todo · 🔗 external (Noeracle/Yahya) · 👤 manual (you, at the end)

## Already done (this + prior sessions)
- ✅ Phase 0 (off-chain quick wins) · Phase 1 (11 contract security items, hardened over 3 adversarial review rounds)
- ✅ Phase 2: P2-4 allowlist · P2-5 router fresh-price liq/exec · P2-6 price backstop · P2-7 keeper watchdog · P2-8 publish defenses · K-8 key hygiene
- ✅ Audit fixes: ~18 confirmed findings incl. CRITICAL insolvency, funding-fold, trailing-stop zombie
- ✅ Size gate resolved (128KB live limit verified; market 73.7KB fits)
- ✅ Phase 4: P4-5/P4-6 stats+volume endpoints
- ✅ stellar-dev skill updated to upstream latest (7 skills) + 128KB correction

## P5 — Risk engine (MAINNET-CRITICAL, contracts) — PRIORITY 1
- ⬜ P5-1  RiskConfig + per-asset OI caps + max-leverage enforcement
- ⬜ P5-2  Maintenance-margin raise (config-driven, per-asset)
- ⬜ P5-5  Partial liquidation (restore margin, don't nuke the whole position)
- ⬜ P5-6  Insurance buffer (absorbs bad debt before LP NAV)
- ⬜ P5-7  ADL (auto-deleverage) when insurance is exhausted
- ⬜ P5-9  Partial position close
- ⬜ P5-8  TWAP / multi-sample oracle smoothing (interim before Noeracle median)
- ⬜ P5-3/4 Funding accounting upgrade (the vault-as-counterparty model is in; formalize the pool)

## P2 — Keeper tail (contracts already done; keeper code) — PRIORITY 2
- ⬜ P2-5(tail) keeper calls router liquidate_with_price / execute_with_price
- ⬜ P2-9  keeper scan restructure (single snapshot/cycle, local health calc)
- ⬜ P2-10 trailing-stop simulate-before-submit
- ⬜ P2-11 RPC failover + fee escalation
- ⬜ P2-12 funding scheduling (tri-state)
- 🔗 P2-1/2/3 Noeracle hardened write path + median (Yahya) — mainnet gate, not ours

## P4 — Off-chain correctness/product — PRIORITY 3
- ⬜ P4-1  API WebSocket hardening (heartbeat, backpressure, auth on subscribe)
- ⬜ P4-7/8 indexer gap detection + reorg safety
- ⬜ P4-13 single price source on the trade page
- ⬜ P4-17 TP/SL at open (G-1)
- ⬜ P4-18/19/20 SDK tx-builders + sdk-py
- ⬜ P4-16 mobile trade flow

## P3 — Ops/infra (code + docs; deploy is manual) — PRIORITY 4
- ⬜ P3-4  env-var address overrides (so a redeploy needs no rebuild)
- ⬜ P3-1  monitoring config (Prometheus/Grafana or OZ Monitor) — config + docs
- ⬜ P3-7  incident runbook (doc)
- ⬜ P3-2  retire legacy deploy scripts
- 👤 P3-6 Turso backups · P3-8 admin 2-of-3 key ceremony (manual)

## P6 — Audit + guarded launch — PRIORITY 5
- ⬜ P6-2  run `cargo scout-audit` (static analysis) + triage
- ⬜ P6-6  guarded-config constants (allowlist, deposit caps, 3 pairs @10x, OI caps)
- ⬜ P6-3  config-parity inventory (demo→mainnet constants)
- ⬜ P6-4  geo-block + ToS gate (web)
- 👤 P6-1 SCF Audit Bank application (manual, external)

## Method per item (soroban skill)
Build → `cargo test` + targeted regression test → `cargo clippy -D warnings` (allow-list) →
adversarial workflow review on fund-critical changes → commit (no AI attribution) → push.
Any blocker → write `docs/issues/<slug>.md` and surface at the end.

## Handoff at the end
`docs/DEPLOY_RUNBOOK.md` (manual ops) + a final problems/decisions report.
