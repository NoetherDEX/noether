# Remediation Register — master findings ledger

Single source of truth for security findings across all sources (tools,
internal reviews, third-party). Tool dashboards are evidence; **this file is
the state**. One entry per root cause; duplicates fold in.

Phases: **pre-freeze** (code, lands before `contracts-v1.0.0-rc1`) ·
**ceremony** (mainnet deploy config/procedure) · **runbook** (ops docs +
keeper duties) · **accepted** (documented, no action) · **post-v1**.

Sources so far: `ALX-*` = Almanax 2026-08-18 (`audit/tools/almanax/2026-08-18/`) ·
`SCT` = Scout / cargo-scout-audit 0.3.16, 2026-08-18, 416 detections
(`audit/tools/scout-audit/2026-08-18/`, triage in `triage.md`). Both scans ran
at the same commit `01dfdea`.

---

> **Remediation sprint 2026-08-19** (commits on `staging`): R-1.1 `e5f2bd4` ·
> R-11 `e9171ea` · R-4 `4e6d998` · R-8 optics `d0cdfed` · R-6 contracts
> `b7366bb` + web `da632de` · R-7 `992d693` · R-13 events `973b406`.
> Full workspace green (426 tests), clippy clean, market WASM 123.7KB.

## R-1 · Storage TTL lifecycle & archival hygiene — CODE CLOSED `e5f2bd4` (runbook items remain)

**Folds in:** ALX-02, ALX-04, ALX-05, ALX-10, ALX-12, ALX-13, ALX-14, ALX-18, ALX-21
**Severity after triage:** Low–Medium (availability), not fund loss.

The scan's TTL findings systematically assumed expired storage reads as
missing (`unwrap_or` firing). Soroban archives persistent/instance entries:
transactions touching an archived entry **fail until restored**
(`RestoreFootprintOp`, anyone can pay), and restoration returns original
values. So there is no reinit takeover (ALX-02), no fund lock-out (ALX-04), no
cap reset (ALX-13), no claim erasure (ALX-14), no cooldown bypass (ALX-21).
What's real: **liveness** — an archived shim/router/referral/risk instance
halts its function until someone restores it, and the shared TTL policy
(threshold ~1d / extend-to ~30d, `noether_common/src/ttl.rs`) only re-extends
on calls landing in the final day, so organic traffic does not reliably keep
entries alive.

**Actions**
1. *Pre-freeze code sweep:* call `extend_instance_ttl` at the top of hot
   entrypoints in all 7 contracts (shim `lastprice`/`twap`; router trade
   paths; referral `record_trade`/`claim`/`set_referrer`; risk `get_config`
   incl. persistent config keys; factory/vault/market already partially do —
   verify coverage per entrypoint).
2. *Runbook/keeper:* scheduled TTL re-pin duty (extend every contract
   instance + WASM + critical persistent keys to a long horizon, e.g. 180d,
   monthly) + TTL monitoring alert. Precedent: prod testnet stack pinned to
   ~180d on 2026-08-04.
3. *Runbook:* restore procedure (how to `RestoreFootprint` an archived entry;
   note modern RPC simulation returns `restorePreamble` and SDKs auto-prepend).
4. *Ceremony:* initial TTL pin right after deploy.

## R-2 · Unbounded VaultList growth in vault_factory — OPEN (ceremony config; post-v1 structural)

**Folds in:** ALX-01, ALX-09, ALX-11 (one root cause, three statements)
**Severity after config:** Low.

Real under default config only (allowlist empty + `max_vaults = 0`). The
L0-20 launch gate already exists and is tested (`set_leader_allowlist`,
`set_max_vaults`, `CreationRestricted`). Reaching the ~64KiB object cap needs
~10k+ creations — impossible once capped.

**Actions:** ceremony sets `max_vaults` (proposal: 50) and/or a leader
allowlist for the beta; config snapshot records it. Structural paging
(`VaultListPage(u32)` or id-range enumeration off `NextVaultId`) deferred
post-v1. *Corroborated by SCT:* Scout's `dos_unexpected_revert_with_storage` +
`dynamic_storage` hits on the factory list files point at the same root cause.

## R-3 · Deploy→initialize race (arbitrary admin) — OPEN (ceremony/runbook)

**Folds in:** ALX-06 (referral; pattern present in every crate)
**Severity:** Low practical (no public mempool on Stellar), high impact if hit.

**Actions:** ceremony runbook — submit deploy + initialize back-to-back per
contract and **verify `get_admin` == multisig before any funding/config**;
abort and redeploy on mismatch. Structural fix (constructor-based init) needs
soroban-sdk ≥ 22; deferred post-v1 (see R-12).

*SCT verification bonus:* all seven `upgrade()` functions are admin-gated
(Scout's 7 Critical "unprotected wasm update" hits are helper-blind false
positives), and the four existing `set_admin` entrypoints (router, shim, risk,
vault) already require **both** old and new admin signatures — the rotation
path the migration uses is typo-brick-proof where it exists. Where it doesn't
exist is R-11.

## R-4 · Vault inflow endpoints trust market accounting — CLOSED `4e6d998`

**Folds in:** ALX-07 (`receive_loss`; same pattern `fund_buffer`,
`route_protocol_fee`)
**Severity:** Accepted (inside trust boundary) + cheap hardening.

Caller is the audited market via `require_auth`. Add a fail-closed solvency
assert after credits: vault physical USDC balance must cover the accounting
buckets; revert on desync. Defense-in-depth, not a vulnerability fix.

## R-5 · NOE supply immutability — OPEN (ceremony, decision box)

**Folds in:** ALX-08
**Severity:** Medium systemic (today the issuer is the SEC-3 single EOA).

Share pricing trusts `total_noe_circulating`; any out-of-band issuer
mint/burn desyncs it. **Options at mainnet ceremony:** (a) pre-mint full
fixed supply to the vault, then lock the issuer (master weight 0) — supply
provably immutable, finding fully closed, strong dossier line; (b) keep
issuer under the 2-of-3 multisig for mint flexibility, document the invariant
and monitoring. **Recommendation: (a).** Decision owner: Yahya.

## R-6 · LP slippage bounds on deposit/withdraw — CLOSED `b7366bb` + `da632de` (scope: both vaults + AUM cap; web derives bounds from simulation pre-quotes)

**Folds in:** ALX-16
**Severity:** Medium (LP fairness under moving AUM/PnL).

Add `min_noe_out` to `deposit`, `min_usdc_out` to `withdraw`; revert below
bound. ABI change → must land before the frozen interface is audited; update
`packages/tx-builders`, web vault page, sdk-ts, sdk-py together.

## R-7 · Shim SEP-40 TWAP fabricates freshness — CLOSED `992d693`

**Folds in:** ALX-03
**Severity:** Medium latent (deployed mode is Noeracle-native; SEP-40 is one
admin `set_backend` away).

In `BACKEND_SEP40` twap, stop returning `env.ledger().timestamp()`: propagate
the backend's own timestamp (e.g. via its `lastprice`) or return `None` so the
market degrades to spot. Add a test: stale SEP-40 backend ⇒ twap freshness
gate rejects.

## R-8 · Arithmetic posture — CLOSED-VERIFIED (optional optics cleanup pre-freeze)

**Folds in:** ALX-15, ALX-17, ALX-19, ALX-20, ALX-22
**Severity:** None reachable.

Verified: `overflow-checks = true` in the contracts release profile — silent
wrap is impossible; overflow traps and reverts (ALX-15/22's premise false;
ALX-15 and ALX-20 contradict each other — a useful reminder that tool output
needs verification). Trap reachability bounded far below i128 by
`min_collateral > 0`, max leverage, max position size, deposit caps (values
~10²⁰ vs 1.7×10³⁸). Id counters are u64 monotonic — unreachable (ALX-17).
Negative size cannot reach volume recording (entry validation, ALX-19).
**Optional pre-freeze optics:** switch hot money math to `checked_*`/`safe_*`
and add a `size > 0` guard in `record_trade_volume` so the firm doesn't
re-raise these.

*Corroborated by SCT:* Scout raised the same family as 275
`integer_overflow_or_underflow` Criticals — same neutralization applies. Two
independent tools flagging it is exactly why the optics cleanup (or this
rationale page in the dossier) is worth having before the firm runs its own
scanners.

## R-9 · Per-user persistent key growth — ACCEPTED

**Folds in:** ALX-23. Attacker pays fees + rent; unpaid entries archive;
self-limiting. Optional courtesy: delete `ShortfallOwed` entries at 0 if the
file is touched anyway.

## R-10 · Day-0 volume sentinel — ACCEPTED

**Folds in:** ALX-24. Only near-epoch timestamps (synthetic test envs) can
hit it; impossible on live networks.

## R-11 · Admin-rotation entrypoints missing on market, referral, vault_factory — CLOSED `e9171ea`

**Source:** SCT (by omission — `missing_new_admin_auth` fired only on the four
contracts that *have* `set_admin`).
**Severity:** Blocker for the multisig migration (P3-8), not an exploit.

Router, shim, risk, and vault expose `set_admin` with the two-side-signed
pattern (`require_admin` + `new_admin.require_auth()`); market, referral, and
vault_factory have only internal storage helpers — no way to hand admin to the
multisig. **Action:** add `set_admin` to all three, copying the verified
both-sign pattern, before freeze. (Supersedes the spec's narrower "market
`set_admin`" register item; check market WASM-size headroom when adding.)

## R-12 · soroban-sdk 21 pin — DOCUMENTED DECISION

**Source:** SCT `soroban_version` (8×, one per crate).
Deliberate: no SDK-major churn between now and the audited freeze; the pinned
toolchain is part of the reproducible-build recipe. Revisit post-v1 — SDK ≥ 22
also unlocks constructor-based init, the structural close for R-3.

## R-13 · Lint-family postures — ACCEPTED (optional batch improvements)

**Source:** SCT. Verdicts with rationale, sampled against code:
- `unsafe_unwrap` (25): instance-config getters panic only pre-initialization
  (guarded by `require_initialized` on public paths) + bounded-index loop
  unwraps; a panic traps and reverts. Optional: typed errors when touched.
- `dos_unbounded_operation` (18) / `dynamic_storage` (15): the documented
  Vec-scan storage convention, bounded by open-count caps and max sizes;
  factory's global list handled in R-2.
- `dos_unexpected_revert_with_storage` (16): factory hits → R-2; market index
  growth is permissionless by design and capped; router/risk hits are
  admin-gated one line above (helper-blind false positives).
- `storage_change_events` (35, enhancement): admin setters/migrations without
  events — optional pre-freeze batch, indexer-friendly.
- `avoid_vec_map_input` (8): all admin-only entrypoints with paired-length
  checks where relevant.
- `unsafe_map_get` (2): `unwrap_or(0)` closures — cannot panic; incomplete
  price maps are prevented upstream by `collect_fresh_cross_prices(..)?`.
- `divide_before_multiply` (2): advisory ADL score + dust-level conservative
  rounding in profit-share math.
- `unused_return_enum` (1): style; invoke traps regardless.

---

## Pre-freeze checklist derived from this register

- [x] R-1.1 TTL extension sweep across 7 contracts — `e5f2bd4`
- [x] R-4 vault inflow solvency assert — `4e6d998`
- [x] R-6 min-out bounds, both vaults + web pre-quote wiring — `b7366bb`, `da632de`
- [x] R-7 SEP-40 twap timestamp fix + tests — `992d693`
- [x] R-8 checked-math optics + `size > 0` guard — `d0cdfed`
- [x] R-11 `set_admin` (both-sign) on market, referral, vault_factory — `e9171ea`
- [x] R-13 storage-change events on 24 admin setters — `973b406`
- [x] Global vault AUM cap (`set_aum_cap`) — in `b7366bb`
- [ ] gitleaks history sweep (before the public mirror goes live)

## Ceremony/runbook items derived from this register

- [ ] R-1.2/1.4 keeper TTL re-pin duty + monitoring; initial pin at deploy
- [ ] R-1.3 restore-procedure runbook
- [ ] R-2 set `max_vaults` (proposal 50) / leader allowlist; record in config snapshot
- [ ] R-3 deploy+init back-to-back; verify `get_admin` == multisig before funding
- [ ] R-5 NOE issuer decision (recommend: pre-mint + lock issuer)
