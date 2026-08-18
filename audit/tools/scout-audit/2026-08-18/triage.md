# Scout Audit Scan — 2026-08-18 (triage)

> **Type: tool report (static analysis / lints). Not an audit.**

| | |
|---|---|
| Tool | CoinFabrik `cargo-scout-audit` **0.3.16** (Soroban detector suite) |
| Target | `NoetherDEX/noether` @ **`01dfdea`** (branch `staging`) — same commit as the Almanax 2026-08-18 scan |
| Scope | `contracts/` workspace — all 8 crates |
| Result | **416 detections**, 13 detectors. Scout severity: 282 Critical / 106 Medium / 1 Minor / 43 Enhancement (per-crate table in `scout-report.md`) |
| Raw output | `scout-report.html` (browsable), `scout-report.json` (machine), `scout-report.md` |
| Triage | Verified against code by Claude, 2026-08-18. Authoritative state: [`../../../remediation/REGISTER.md`](../../../remediation/REGISTER.md) |

**Bottom line:** zero new vulnerabilities. Every Critical-severity detection is
either neutralized by the build profile (275× overflow — `overflow-checks =
true` traps and reverts) or a helper-blind false positive (7× "unprotected"
`upgrade()` — each has `require_admin(&env)?` on the line above the flagged
call; Scout only recognizes a literal `require_auth` in the same body). The
scan's real contribution is **by omission**: it confirmed which contracts have
a two-side-signed `set_admin` (router, shim, risk, vault) — and thereby that
**market, referral, and vault_factory have no admin-rotation entrypoint at
all**, which the multisig migration requires → register R-11.

## Detector-by-detector verdicts

| Detector (count) | Scout sev | Verdict |
|---|---|---|
| `integer_overflow_or_underflow` (275) | Critical | **Neutralized (R-8).** `overflow-checks = true` in the release profile: overflow traps and reverts, never wraps. Magnitudes bounded far below i128 by min-collateral, leverage, position-size and deposit caps. Cross-tool corroboration: same family as Almanax ALX-15/20/22. Optional checked-math optics cleanup stands — any auditor running Scout will see these 275 flags; R-8's rationale (or the cleanup) preempts it. |
| `storage_change_events` (35) | Enhancement | **Optional (R-13).** Admin setters/migration helpers (e.g. `migrate_config`, `seed_open_counts`) mutate storage without events. Best practice + indexer-friendly; batch-add events to admin setters if touched pre-freeze. |
| `unsafe_unwrap` (25) | Medium | **Accepted (R-13).** Sampled all locations: instance-config getters (`Admin`/`UsdcToken`/… `.unwrap()`) that can only panic pre-initialization — guarded by `require_initialized` on public paths; plus bounded-index loop unwraps. A panic traps and reverts; no state corruption, no user-input-driven unwrap found. Optional: convert to typed errors when files are touched. |
| `dos_unbounded_operation` (18) | Medium | **Accepted-by-design (R-13).** The documented Vec-scan storage convention (AllPositions/AllOrders/TraderPositions, per-vault lists). Bounded in practice by position/order open-count caps and max sizes. |
| `dos_unexpected_revert_with_storage` (16) | Medium | **Split.** Factory list growth (5 hits) = R-2 (close via `max_vaults`/allowlist at ceremony). Market index growth (8) = permissionless by design (it's a DEX), bounded by open-count caps. Router 564 + risk 154 = false positives — both are admin-gated one line above (helper-blindness). Router 752 flags an in-memory Vec build bounded by quorum size, not storage. |
| `dynamic_storage` (15) | Medium | **Accepted-by-design (R-13).** Vec/String values in persistent storage are the documented architecture; factory's global list is R-2; router's config Vecs are admin-set and small. |
| `soroban_version` (8) | Enhancement | **Documented decision (R-12).** soroban-sdk pinned at 21 for v1 — deliberate: no SDK-major churn between now and the audited freeze. Revisit post-v1; SDK ≥ 22 also unlocks constructor-based init (closes R-3 structurally). |
| `avoid_vec_map_input` (8) | Medium | **Accepted.** All Vec-taking entrypoints are admin-only (router publisher/stork config, risk config, factory allowlist); admin validates inputs; lengths are checked where paired (`ids.len() != tags.len()`). |
| `unprotected_update_current_contract_wasm` (7) | Critical | **False positive — all 7 verified.** Every `upgrade()` (market, vault, factory, referral, risk, shim, router) calls `require_admin(&env)?` immediately before `update_current_contract_wasm`. Detector doesn't follow auth helpers. |
| `missing_new_admin_auth` (4) | Medium | **False positive — all 4 verified.** Router, shim, risk, vault `set_admin` all do `require_admin` **and** `new_admin.require_auth()` — the exact two-side-signed handoff the detector asks for (vault's hit is on the raw storage helper; its public wrapper is properly authed). Positive finding for the multisig migration: existing rotations are typo-brick-proof. |
| `unsafe_map_get` (2) | Medium | **False positive.** Both are `prices.get(..).unwrap_or(0)` closures — cannot panic. The `0` fallback is shielded by `collect_fresh_cross_prices(..)?` erroring out before an incomplete map is used. |
| `divide_before_multiply` (2) | Medium | **Accepted.** market lib.rs:2301 is the advisory ADL ranking score for the event tape (precision immaterial to money). factory math.rs:117 truncates before the bps multiply — dust-level (<1 stroop-scale) rounding, downward/conservative; reorder only if touched. |
| `unused_return_enum` (1) | Minor | **Accepted (style).** Cross-contract wrapper keeps a uniform `Result` signature; the invoke traps on failure regardless. |

## Actions fed into the register

- **R-11 (new, pre-freeze):** add admin-rotation entrypoints to **market,
  referral, vault_factory**, copying the verified both-sign pattern
  (`require_admin` + `new_admin.require_auth()`); required by the multisig
  migration. Supersedes the earlier "market `set_admin`" register item.
- **R-12 (new, decision):** soroban-sdk 21 pin documented for v1.
- **R-13 (new, accepted/optional):** lint-family postures — unwrap-getters,
  Vec-scan storage, dynamic storage, storage-change events (optional batch),
  div-before-multiply dust.
- **R-2, R-8:** corroborated by a second independent tool at the same commit.
