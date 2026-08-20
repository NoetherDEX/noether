# Internal security reviews — index

> **Type: internal reviews (Claude-assisted). Not third-party audits.**

The reports below live at their canonical repo paths (moving them would break
existing cross-references in TASKS/registers); this index is the dossier's
entry point to them.

| Date | Report | Canonical path | Scope / outcome |
|---|---|---|---|
| 2026-06-09 | **Full-stack audit — 87 findings** | [`docs/AUDIT-2026-06.md`](../../docs/AUDIT-2026-06.md) | Contracts + web + keeper + infra; drove the 2026-07 remediation phases (P0–P6, ~77 commits) and the WASM refit. Founder decisions + docs-vs-code corrections recorded alongside in TASKS.md. |
| 2026-08-04 | **Stack audit — 13 finder agents + 6 verifiers + 3 judge panels** | [`docs/superpowers/specs/2026-08-04-*-design.md`](../../docs/superpowers/specs/) | Whole-stack sweep behind the Phase-0 on-chain hardening (retired-stack drain + pause, 180d TTL pin, Stork signer fix, gate leak close). |
| planned (at freeze) | Pre-freeze full-depth review | — | Claude full-context audit of the frozen `contracts-v1.0.0-rc1` tag, before the Audit Bank firm window. |
| planned (at freeze) | Frontier-model review | — | Independent GPT-model pass over the frozen tag (OpenAI API credits confirmed) — model-diversity hedge against single-reviewer blind spots. |
