# Noether Security Audit Dossier

Working folder for all security artifacts on the road to mainnet v1. See
`docs/superpowers/specs/2026-08-18-mainnet-v1-launch-design.md` §4 for the full
program design.

**Labeling rule (applies to everything public):** every artifact is labeled as
*internal review*, *tool report*, or *third-party audit*. Tool output is never
called an audit.

**v1 scope (decision 2026-08-22):** the deployment and the third-party audit
cover SIX contracts — market, vault, noeracle_shim, noether_router,
vault_factory, referral. `contracts/risk` is in the tree but unshipped and
out of scope: built for the old 64KB WASM ceiling, obsoleted when the 128KB
limit let partial-liq/ADL live in-market (per-pair risk config = the market's
`set_asset_risk` ladder). `audit/config-snapshots/` holds dated
`snapshot_config.sh` outputs (49 config entries across the six contracts).

## Layout

```
audit/
  README.md                 — this index
  internal/                 — manual deep audits (Claude + frontier-model reviews)
  tools/<tool>/<date>/      — raw tool output + normalized report + triage
  external/                 — third-party (Audit Bank) reports
  remediation/REGISTER.md   — master findings register (single source of truth)
  release/v1/               — frozen dossier for the mainnet v1 ceremony
```

## Artifacts

| Date | Type | Artifact | Scope | Status |
|---|---|---|---|---|
| 2026-08-18 | Tool report | [`tools/almanax/2026-08-18/`](tools/almanax/2026-08-18/findings.md) — Almanax (Stellar agent, Default mode), 24 findings @ `01dfdea` | contracts/ (8 crates) | Triaged → register |
| 2026-08-18 | Tool report | [`tools/scout-audit/2026-08-18/`](tools/scout-audit/2026-08-18/triage.md) — CoinFabrik Scout 0.3.16, 416 detections @ `01dfdea` | contracts/ (8 crates) | Triaged → register (R-11/R-12/R-13 added) |
| 2026-08-19 | Tool report | [`tools/scout-audit/2026-08-19-postfix/`](tools/scout-audit/2026-08-19-postfix/delta.md) — Scout re-run after the remediation sprint, 416→390 | contracts/ (8 crates) | Delta documented; all residuals verdicted |
| 2026-08-20 | Tool report | [`tools/cargo-audit/2026-08-20/`](tools/cargo-audit/2026-08-20/report.txt) — cargo-audit + cargo-deny, clean after `time`/`keccak`/`spin` bumps | contracts/Cargo.lock | 0 vulnerabilities; policy in `contracts/deny.toml` |
| 2026-08-20 | Tool report | [`tools/osv-scanner/2026-08-20/`](tools/osv-scanner/2026-08-20/report.txt) — osv-scanner over both lockfiles, clean after runtime npm fixes (`ws`, `form-data`, swagger-ui→v6) | Cargo.lock + package-lock.json | 0 open; triaged ignores in `osv-scanner.toml` (incl. 5 soroban-sdk-21 advisories → R-12) |
| continuous | CI lane | [`.github/workflows/security.yml`](../.github/workflows/security.yml) — cargo-audit + cargo-deny + osv on every PR; Scout weekly with artifact upload | repo | Fails on any un-triaged advisory |
| — | Internal reviews | [`internal/README.md`](internal/README.md) — index of the 2026-06 87-finding audit + 2026-08-04 stack audit + planned freeze-time reviews | full stack | Indexed |

Pending intake: 2026-06 87-finding internal audit, 2026-08-04 stack audit
(currently under `docs/`), scout-audit / cargo-audit / osv-scanner CI runs,
frontier-model review (at freeze), Audit Bank report (application submitted).
