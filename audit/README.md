# Noether Security Audit Dossier

Working folder for all security artifacts on the road to mainnet v1. See
`docs/superpowers/specs/2026-08-18-mainnet-v1-launch-design.md` §4 for the full
program design.

**Labeling rule (applies to everything public):** every artifact is labeled as
*internal review*, *tool report*, or *third-party audit*. Tool output is never
called an audit.

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

Pending intake: 2026-06 87-finding internal audit, 2026-08-04 stack audit
(currently under `docs/`), scout-audit / cargo-audit / osv-scanner CI runs,
frontier-model review (at freeze), Audit Bank report (application submitted).
