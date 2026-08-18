# Almanax Scan — 2026-08-18 (normalized report)

> **Type: tool report (AI-assisted static analysis). Not an audit.**

| | |
|---|---|
| Tool | Almanax (app.almanax.ai), **Stellar agent**, **Default** scan mode |
| Target | `NoetherDEX/noether` @ **`01dfdea`** (branch `staging`) |
| Scope | `contracts/` — 8 crates (market, vault, vault_factory, referral, risk, noeracle_shim, noether_router, noether_common), 23 files |
| Ran | 2026-08-18 22:30 (initiated by Yahya) |
| Result | **24 findings**: 0 critical / 8 high / 8 medium / 7 low / 1 info |
| Capture | Free tier (JSON export paywalled) — findings copied verbatim from the UI. ALX-17's description was not captured; its verdict is from direct code review. |
| Triage | Verified against code by Claude, 2026-08-18. Verdicts + grouped actions live in [`../../../remediation/REGISTER.md`](../../../remediation/REGISTER.md). |

**Triage summary.** 24 findings collapse into 10 root causes (R-1…R-10 in the
register). Verified facts that drive the verdicts: `overflow-checks = true` in
the contracts release profile (so nothing "wraps silently" — overflow traps and
reverts); shared TTLs are ~1-day threshold / ~30-day extend
(`noether_common/src/ttl.rs`); the shim's deployed mode is Noeracle-native
(`BACKEND_NOERACLE = 0` default), making the SEP-40 TWAP issue latent; the
vault factory already ships an L0-20 launch gate (leader allowlist + max-vaults
cap, tested); and market entrypoints enforce `min_collateral`/max-size, so
sizes are strictly positive. The scanner's single systematic error: it treats
expired persistent/instance storage as *silently missing* (`unwrap_or`
fallbacks firing). On Soroban, expired persistent/instance entries are
**archived, not deleted** — a transaction touching an archived entry fails
until the entry is restored (`RestoreFootprintOp`, anyone can pay), and the
restored entry keeps its original value. Contract code never observes an
archived entry as `None`. That converts every "takeover / funds lost / cap
reset / claim erased" TTL claim into an availability/operations issue.

Verdict key: **Confirmed** (real, action scheduled) · **Confirmed-latent**
(real in a non-active configuration) · **Procedural** (real, mitigated by
runbook/config rather than code) · **False positive** (stated exploit does not
hold; residual noted) · **Accepted** (true observation, risk accepted with
rationale).

---

## ALX-01 · HIGH · Resource Management: Unbounded VaultList Vec can brick contract

`contracts/vault_factory/src/types.rs` L55–L75 — **Verdict: Confirmed (config-gated) → R-2**

`StorageKey::VaultList` is a single persistent `Vec<u32>` of all vault ids ever
created; `create_vault` appends on every creation. With permissionless creation
(allowlist empty) and no pruning/pagination, an attacker can spam
`create_vault` until the list exceeds Soroban's per-object size cap (~64KiB) or
becomes too expensive to (de)serialize; from then on `create_vault` and
list-readers (`get_vault_ids`, the max-vaults cap check) deterministically
fail.

*Recommendation (tool):* derive ids from `NextVaultId` for enumeration, or page
the list (`VaultListPage(u32)`), or enforce a hard cap / restrict creation.

*Triage:* the code already has the L0-20 launch gate — `set_leader_allowlist`
(empty = permissionless) and `set_max_vaults` (0 = unlimited), enforced with
`FactoryError::CreationRestricted` and covered by
`create_vault_allowlist_and_cap_enforced`. The finding is real only for the
default config. Launch action: set a nonzero `max_vaults` (and/or allowlist)
at the mainnet ceremony. Structural paging deferred post-v1. Duplicates:
ALX-09, ALX-11.

## ALX-02 · HIGH · Contract Lifecycle & State: Instance TTL expiry enables contract reinitialization takeover

`contracts/referral/src/storage.rs` L11–L33 — **Verdict: False positive (exploit); availability residual → R-1**

Claim: if referral instance storage archives (~30d without extension),
`is_initialized()` returns `false` (missing key ⇒ `unwrap_or(false)`) and any
attacker re-runs `initialize` as admin, then upgrades/drains.

*Triage:* the exploit rests on the archived-equals-missing misread. When the
instance entry is archived, **every invocation of the contract fails with an
entry-archived error until the instance is restored** — `is_initialized()`
never executes against a missing key, and restoration brings back
`Initialized = true` with the original admin. No takeover path exists. The real
residual is liveness (contract unusable until someone pays the restore), which
R-1 addresses with hot-path TTL extension, a keeper re-pin duty, and a restore
runbook.

## ALX-03 · HIGH · Business Logic: SEP-40 TWAP reports "now" masking staleness

`contracts/noeracle_shim/src/lib.rs` L192–L212 — **Verdict: Confirmed-latent → R-7**

In `twap` under `BACKEND_SEP40`, the shim returns
`(rescaled_mean, env.ledger().timestamp())`, fabricating freshness. The market
uses that timestamp for its `twap_max_age_secs` gate, so a stale/frozen SEP-40
TWAP would always pass the staleness check, weakening liquidation/trigger
gating during an oracle outage.

*Triage:* correct on the code. Latent, not active: the deployed backend mode is
Noeracle-native (`BACKEND_NOERACLE = 0`, the `unwrap_or` default); the SEP-40
branch only runs after an admin `set_backend(1, …)`. Fix pre-freeze regardless
(propagate the backend's own timestamp — e.g. from `lastprice` — or return
`None` in SEP-40 mode), because the config flip is one admin call away.

## ALX-04 · HIGH · Contract Lifecycle & State: Persistent state can expire, locking funds

`contracts/vault_factory/src/storage.rs` L98–L207 — **Verdict: False positive (permanent loss); availability residual → R-1**

Claim: vault rows, share balances, and position/order maps expire after TTL,
so depositors "permanently lose access" (VaultNotFound, shares read as 0).

*Triage:* archived-equals-missing misread again. Archived persistent entries
make transactions fail until restored; after restoration the row/shares return
with original values. Modern RPC simulation even returns a `restorePreamble`
so SDKs auto-prepend the restore. Funds are never orphaned; the residual is
that an idle vault needs a restore before use. R-1: extend TTLs in
state-mutating entrypoints across related keys, keeper re-pin duty, restore
runbook.

## ALX-05 · HIGH · Resource Management: Instance TTL not refreshed, contract can brick

`contracts/referral/src/lib.rs` L173–L255 — **Verdict: Partially confirmed (availability) → R-1**

Referral extends instance TTL only in `initialize` and `create_code`; hot paths
(`record_trade`, `claim`, `set_referrer`, admin setters) never extend, so with
~30-day extend-to the instance can archive despite active use.

*Triage:* correct observation, wrong consequence ("locking any USDC" — an
archived instance is restorable, funds survive). Real availability gap: fee
discounts and claims halt until restore. Note the shared TTL semantics:
threshold is ~1 day, so a call only re-extends when remaining TTL is already
inside the final day — sporadic traffic does not reliably keep entries alive,
which is why R-1 pairs the code sweep with a keeper re-pin duty. (Current prod
testnet stack was operationally pinned to ~180d on 2026-08-04.)

## ALX-06 · HIGH · Contract Lifecycle & State: Anyone can seize admin via initialize

`contracts/referral/src/lib.rs` L48–L69 — **Verdict: Procedural (real, low practical risk) → R-3**

`initialize(admin, …)` accepts an arbitrary admin (only `admin.require_auth()`),
so between deploy and the team's initialize, an attacker could initialize first
and own the contract. The same deploy-then-init pattern exists in every crate
(verified in vault_factory).

*Triage:* real race, standard Soroban footgun. Practical risk is low on
Stellar — there is no public mempool to snipe from; the attacker must watch
closed ledgers and win a same-ledger race against an init submitted seconds
after the deploy. Mitigation is procedural and mandatory: ceremony submits
deploy + initialize back-to-back and **verifies `get_admin` equals the multisig
before any funding or config**. Constructor-based init (SDK ≥ 22) is the
structural fix, deferred — the current SDK is 21 and an SDK bump before freeze
is out of scope.

## ALX-07 · HIGH · Cross-Contract Calls: Loss accounting can be inflated without transfer

`contracts/vault/src/lib.rs` L429–L451 — **Verdict: Accepted (trust boundary) + hardening → R-4**

`receive_loss(amount)` credits `total_usdc` without verifying USDC actually
arrived; a buggy/compromised market could inflate AUM and let withdrawers
drain unreserved liquidity. Same pattern in `fund_buffer`,
`route_protocol_fee`.

*Triage:* the endpoint is gated by `market_contract.require_auth()` — the
market is trusted, audited code and the only caller; "market is compromised"
already implies total loss through more direct paths. Accepted as designed,
**but** the suggested invariant is cheap defense-in-depth worth adding
pre-freeze: after crediting, assert the vault's physical token balance covers
the accounting buckets (fail-closed on desync). Scheduled as hardening, not a
vulnerability fix.

## ALX-08 · HIGH · Asset and Token Operations: NOE supply tracking can desync from token

`contracts/vault/src/lib.rs` L171–L267 — **Verdict: Confirmed (systemic) → R-5**

Share pricing uses the internal `total_noe_circulating` counter. NOE is a
SAC-wrapped classic asset: its issuer can mint/burn outside the vault, which
would desync the counter and let redemptions overpay USDC per NOE.

*Triage:* correct systemic observation; today the issuer key is the SEC-3
single EOA, which is exactly the exposure. The clean fix is ceremonial, not
code: on mainnet, pre-mint the full fixed NOE supply to the vault, then **lock
the issuer account** (master weight 0) so supply is provably immutable — the
counter can then never desync — or, if mint flexibility must be retained, put
the issuer under the 2-of-3 multisig and document the invariant. Decision box
in the launch plan; dossier states the outcome either way.

## ALX-09 · MEDIUM · Resource Management: Unbounded vault list can brick contract

`contracts/vault_factory/src/lib.rs` L82–L154 — **Verdict: Duplicate of ALX-01 → R-2**

Same root cause described from `create_vault`'s side (append + cap check that
itself reads the full list). Same action: nonzero `max_vaults` / allowlist at
launch; paging later.

## ALX-10 · MEDIUM · Contract Lifecycle & State: Instance storage TTL not maintained causing shutdown

`contracts/noeracle_shim/src/lib.rs` L116–L225 — **Verdict: Partially confirmed (availability) → R-1**

Shim extends instance TTL only in `initialize`; `lastprice`/`twap` never do.
An archived shim instance halts every price read — and therefore trading —
until restored. Highest-impact member of the TTL family since the whole market
depends on this contract's liveness. R-1 sweep covers it (extend on
`lastprice`/`twap`), plus keeper re-pin.

## ALX-11 · MEDIUM · Resource Management: Unbounded global vault list can DoS creation

`contracts/vault_factory/src/storage.rs` L141–L161 — **Verdict: Duplicate of ALX-01 → R-2**

Third statement of the VaultList growth issue, from `append_vault_list`.

## ALX-12 · MEDIUM · Contract Lifecycle & State: Instance storage TTL extended only at init

`contracts/noether_router/src/lib.rs` L212–L233 — **Verdict: Partially confirmed (availability) → R-1**

Router extends instance TTL only at `initialize`; no entrypoint extends
afterward. Same family as ALX-05/10. One correction to the finding's threat
model: an attacker cannot "prevent TTL extension by submitting failing
transactions" — failed transactions don't block others; inactivity alone is
the trigger. Router liveness matters (it's the verify-then-trade path), so it's
in the R-1 sweep + keeper duty.

## ALX-13 · MEDIUM · Business Logic: Deposit cap resets after TTL expiration

`contracts/vault/src/storage.rs` L344–L352 — **Verdict: False positive → R-1 (note)**

Claim: `Deposited(Address)` expires ⇒ `get_deposited` returns 0 ⇒ user
re-deposits up to the cap repeatedly.

*Triage:* archived-equals-missing misread. An archived `Deposited` entry makes
the deposit transaction fail until restored, and restoration returns the
original cumulative value — waiting cannot reset the cap. Residual is the
generic R-1 availability note only.

## ALX-14 · MEDIUM · Business Logic: Shortfall claims can be lost to TTL

`contracts/vault/src/storage.rs` L281–L289 — **Verdict: False positive → R-1 (note)**

Same misread applied to `ShortfallOwed(Address)`: an archived claim is
restorable with its original value, not erased; the `Shortfall == Σ owed`
invariant survives. Residual: a claimant with a long-idle entry needs a
restore before `claim_shortfall` — covered by the R-1 runbook (and the keeper
re-pin makes it moot in practice).

## ALX-15 · MEDIUM · Arithmetic and Financial Logic: Unchecked math can wrap and corrupt accounting

`contracts/noether_common/src/math.rs` L20–L329 — **Verdict: False positive (premise) → R-8**

Claim: unchecked i128 math "wraps silently in optimized WASM builds," letting
attackers mint/extract via overflow.

*Triage:* the premise is verifiably false — `contracts/Cargo.toml` sets
`overflow-checks = true` in the release profile (ALX-20, from the same scan,
says so explicitly; the two findings contradict each other). Overflow traps
and reverts the transaction; no value corruption is possible. The residual
(can an attacker *reach* a trap?) is ALX-20's framing — see R-8: input
magnitudes are bounded by `min_collateral`, max leverage, max position size
and deposit caps, keeping intermediates ~10²⁵ below i128 range. Optional
pre-freeze cleanup: move hot money-math to `checked_*`/`safe_*` for audit
optics.

## ALX-16 · MEDIUM · Business Logic: LP actions lack slippage bounds on outputs

`contracts/vault/src/lib.rs` L148–L311 — **Verdict: Confirmed (improvement) → R-6**

`deposit`/`withdraw` take no `min_noe_out`/`min_usdc_out`; minted/redeemed
amounts depend on AUM and unrealized PnL, which move between signing and
inclusion.

*Triage:* legitimate. No mempool front-running on Stellar, but state moves
honestly (marks, funding, settlements) and LPs deserve bounded outcomes.
Scheduled pre-freeze because it is an ABI change (must land before the firm
audits the frozen interface) and ripples into `packages/tx-builders`, web, and
both SDKs.

## ALX-17 · LOW · Arithmetic and Financial Logic: Order/position ID counters can overflow silently

`contracts/market/src/storage.rs` — **Verdict: False positive → R-8 (note)**

(Description not captured from the UI; verified directly.) Position/order id
counters are u64 monotonic increments. Exhausting u64 requires ~1.8×10¹⁹
transactions; unreachable. With `overflow-checks = true` an overflow would
trap, not wrap, anyway.

## ALX-18 · LOW · Contract Lifecycle & State: Storage TTL not maintained on reads

`contracts/risk/src/lib.rs` L58–L208 — **Verdict: Partially confirmed (availability) → R-1**

Risk contract bumps instance TTL only at `initialize`; `get_config` reads
persistent `Config(asset)` without extending. Archived risk config halts
markets that read it (fail-closed) until restore. In the R-1 sweep (extend on
`get_config` reads + instance bumps) and keeper duty.

## ALX-19 · LOW · Input and Parameter Validation: Unvalidated negative trade size corrupts volume tiers

`contracts/market/src/trading.rs` L95–L111 — **Verdict: False positive (unreachable) → R-8 (note)**

`record_trade_volume` adds `size` unchecked; a negative size would deflate
rolling volume and shift fee tiers.

*Triage:* no public path produces a non-positive size: `open_position`/cross
variants enforce `collateral >= config.min_collateral` (with
`min_collateral > 0` enforced at config validation) and bounded leverage;
orders check the same at placement; size = collateral × leverage is therefore
strictly positive at every call site feeding volume recording. Optional
one-line `size > 0` guard in the recording path as boundary hardening.

## ALX-20 · LOW · Arithmetic and Financial Logic: Overflow traps can DoS fee/volume updates

`contracts/market/src/trading.rs` L95–L145 — **Verdict: Accepted (theoretical) → R-8**

Correct premise (overflow-checks trap and revert). For the trap to fire,
`size`, daily volume sums, or `size × fee_units` must approach i128 bounds
(~1.7×10³⁸). With max position $100k at 7 decimals (10¹²), 14-day windows of
capped trades, and FEE_PRECISION 10⁵, intermediates stay ≤ ~10²⁰. Unreachable
under any configured cap; config validation keeps caps sane. Accepted;
revisit if caps ever rise by many orders of magnitude.

## ALX-21 · LOW · Business Logic: Withdraw cooldown can be bypassed via TTL

`contracts/vault/src/storage.rs` L154–L162 — **Verdict: False positive → R-1 (note)**

Claim: let `LastDepositTs` expire ⇒ reads 0 ⇒ cooldown-exempt withdraw.

*Triage:* archival misread once more — an archived timestamp entry fails the
withdraw until restored with its original value. Additionally the cooldown is
seconds-to-days while the TTL window is ~30 days, and the `0 ⇒ exempt` branch
exists deliberately for pre-upgrade depositors. No action beyond R-1.

## ALX-22 · LOW · Arithmetic and Financial Logic: Position value addition can overflow silently

`contracts/noether_common/src/math.rs` L110–L118 — **Verdict: False positive (premise) → R-8**

Same wrong "wraps silently" premise as ALX-15; `overflow-checks = true` traps.
Magnitudes bounded by position caps. Covered by the optional R-8 `checked_*`
cleanup.

## ALX-23 · LOW · Resource Management: Persistent per-user keys can grow unbounded

`contracts/vault/src/lib.rs` L159–L931 — **Verdict: Accepted → R-9**

Per-address entries (`Deposited`, `LastDepositTs`, `ShortfallOwed`) are never
removed, so many one-shot addresses bloat persistent storage.

*Triage:* true, self-limiting: the attacker pays every transaction fee and the
rent model prices the storage; entries also archive when unpaid. Accepted for
v1; optional courtesy cleanup (delete `ShortfallOwed` when it hits 0) if
touched anyway.

## ALX-24 · INFO · Business Logic: Day-0 sentinel can mis-handle real day 0

`contracts/market/src/trading.rs` L59–L69 — **Verdict: Accepted (test-env only) → R-10**

`last_update_day == 0` doubles as the uninitialized sentinel; a genuine
epoch-day-0 trade would reinitialize the window. Mainnet/testnet ledger
timestamps are decades past epoch day 0; only synthetic test environments with
near-zero timestamps can hit it. No action.
