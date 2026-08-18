# Scout re-run after the remediation sprint — 2026-08-19

> **Type: tool report (delta). Not an audit.**

Same tool (cargo-scout-audit 0.3.16), same scope, run after the 2026-08-19
remediation sprint (commits `e5f2bd4`…`973b406` on `staging`; see
`../../../remediation/REGISTER.md`). Raw output: `scout-report.json`.

| Detector | Pre (08-18) | Post | Why |
|---|---|---|---|
| storage_change_events | 35 | **11** | 24 admin setters now emit events (R-13). Remaining 11 = the two initializes (deliberately silent — the deploy is the observable event) and non-setter mutations (hot-path reserve/volume writes, `migrate_config`, `seed_open_counts`) where per-call events are cost, not signal. |
| integer_overflow_or_underflow | 275 | 272 | 4 share/value fns converted to `checked_*` (R-8); the new AUM-cap/min-out lines re-add a few flags of the same neutralized class (`overflow-checks = true` traps; caps bound magnitudes — R-8 rationale unchanged). |
| missing_new_admin_auth | 4 | 5 | The +1 is one of the NEW R-11 `set_admin`s — same helper-blind false positive as the original four (all six enforce `require_admin` + `new_admin.require_auth`; verified in code and covered by auth-matrix tests). |
| everything else | — | unchanged | Documented verdicts in `../2026-08-18/triage.md` (upgrade-auth false positives, Vec-scan architecture, unwrap-getter posture, SDK-21 pin) are unchanged by design. |
| **Total** | **416** | **390** | |

The residual 390 are, in full: the neutralized overflow family (R-8
rationale), helper-blind auth false positives (verified), accepted
architecture postures (R-13), the documented SDK pin (R-12), and the
deliberately-silent mutation sites above. No open, unverdicted detection
remains.
