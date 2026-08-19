# Noether v1 Mainnet Launch Program — Design

- **Date**: 2026-08-18
- **Status**: Approved in discussion (Yahya), spec pending final review
- **Scope**: Tranche 3 mainnet launch — access system, audit dossier, launch readiness & release process
- **Supersedes**: the code-based launch gate as the long-term access mechanism (`docs/LAUNCH-GATE.md` stays valid as the gate runbook; access codes remain a fallback path)

## 1. Summary

Noether v1 launches on **mainnet** behind an approval gate. Three workstreams:

- **A — Access system**: public waitlist on noether.exchange, admin approval panel, Postgres-backed allowlist that unlocks site + API together.
- **B — Audit dossier**: `audit/` folder with internal reviews, tool reports, and a third-party Audit Bank report; provenance-pinned to commits and on-chain WASM hashes; surfaced on the public `/audit` page and a public contracts mirror repo.
- **C — Launch readiness & release**: on-chain caps as the real risk enforcement, feature freeze, audit-first sequencing, multisig ceremony, seeded liquidity, jury wave, then progressive opening.

Timeline follows SCF guidance (Ashley, 2026-08): **freeze → Audit Bank audit → remediate → submit tranche with the report attached → mainnet ceremony → jury waves.** No fixed dates; the audit is the pacing item.

## 2. Enforcement model (decided)

- The frontend launch gate (`LAUNCH_GATE=1`, HMAC cookie, middleware) is **UX and wave control only** — mainnet contracts are permissionless.
- Real risk enforcement is **on-chain caps**, nearly all of which already exist: market `MarketConfig` (max position size, max leverage, margins — admin setters), vault per-account deposit cap (`set_deposit_cap`, enforced + tested), OI caps (70%/25% of vault AUM), pause buckets, partial liquidation + insurance buffer (staging-verified; insurance pays winners before LPs — `insurance_buffer_pays_winners_before_lp`).
- **One addition before freeze**: global vault AUM cap (`set_aum_cap`; deposit reverts above ceiling; 0 = off). Reuse an existing error variant — the ~50-variant contracterror ceiling is real.
- No on-chain identity allowlist. Cap changes between waves are admin invokes (fractions of XLM), not upgrades.
- `upgrade()` is **retained** on every contract, gated behind the multisig admin. Immutability is a maturity milestone, not a launch feature. Upgrade disciplines (runbook): new WASM must remain storage-layout compatible, and must itself expose `upgrade()` — verify before invoking, every time.

## 3. Workstream A — Access system

### 3.1 Data model (existing prod Postgres, one new migration in the existing stream)

- **`access_grants`**: `wallet` (StrKey, PK), `email` (nullable), `status` (`pending|approved|rejected|revoked`), `source` (`waitlist|admin|code_migration`), `wave` (free tag), `segment` (`trader|lp|both`), `attested_at` + `tos_version`, `requested_at`, `decided_at`, `decided_by`, `notes`, `email_sent_at`.
- **`access_audit_log`**: append-only — `actor`, `action` (`approve|reject|revoke|export|note`), `wallet`, `detail` jsonb, timestamp. Every admin action logs here.
- PII = email only. Deletion request nulls the email, keeps the wallet row.
- Migration script seeds current `API_KEY_ALLOWLIST` wallets as `source='code_migration', status='approved'`; the env var is then retired.

### 3.2 Gateway API (api/, Fastify)

Public (per-IP rate-limited; Turnstile verified server-side on POST):
- `POST /v1/waitlist` — `{wallet, email?, segment?, attest, turnstileToken}`. StrKey checksum + email format validation. Idempotent upsert; re-submission returns current status.
- `GET /v1/waitlist/status?wallet=` — coarse `pending|approved|none`.
- `POST /v1/access/verify` — signed challenge XDR (reuses `walletAuth` verification) + grant check; called server-side by the web unlock route.

Admin (existing wallet-challenge bearer auth + `requireAdmin` guard: wallet ∈ `ADMIN_WALLETS` env — Yahya's and Mert's **personal** wallets, never the current god key, never the multisig keys):
- `GET /v1/admin/waitlist` — paged, filter by status/wave/search.
- `POST /v1/admin/waitlist/decide` — batch `{wallets[], action, wave?, notes?}`; audit-logged; queues approval emails.
- `GET /v1/admin/waitlist/export.csv` — export itself audit-logged.

Gateway beta gate reads `access_grants.status='approved'` instead of the env allowlist → one approval unlocks site + API instantly, no restarts.

### 3.3 Email

**Azure Communication Services** (decided — no new vendor). One transactional template: "You're approved — wave N." Send failures leave `email_sent_at` null; admin panel shows unsent + resend button. DKIM/domain setup via the Cloudflare MCP.

### 3.4 Web (noether-web)

- **Waitlist form on the `/audit` teaser**: wallet (paste with checksum validation + "use connected wallet" fill), optional email, optional segment select, **required attestation checkbox** (ToS + "not a US/sanctioned person" — the waitlist form is the compliance checkpoint), Turnstile. **Joining requires no signature**; ownership is proven at unlock.
- **Unlock flow**: "Already approved? Connect wallet" → sign challenge (message signing, no fees) → web route `/api/access/wallet` → gateway `POST /v1/access/verify` → sets the existing HMAC cookie → redirect to `/trade`. Cookie payload v2 `{v:2, wallet?, iat}`; **7-day TTL** for wallet-earned cookies (code-earned keep 30d). Revocation: API denies instantly via DB; site access ages out ≤7 days; secret rotation remains the nuclear option. Magic links + 5-tap easter egg keep working.
- **`/admin`**: one page — pending table default, filters, batch approve with wave tag, per-row notes, counts, CSV export. shadcn table, existing patterns.
- **`/terms`**: static ToS (standard DEX beta template; proper review before public launch, not before wave 1).
- Middleware: unchanged check + whitelist for the new routes.

## 4. Workstream B — Audit dossier

### 4.1 Folder layout

```
audit/
  README.md                — index: every report with date, scope, commit, type, status
  internal/                — 2026-06 87-finding audit, 2026-08 stack audit, pre-freeze full audit,
                             frontier-model (GPT) independent review
  tools/<tool>/<date>/     — raw output (PDF/JSON) + one-page triage per run
  external/                — Audit Bank firm report(s)
  remediation/REGISTER.md  — master findings register, one ID per finding, status tracked
  release/v1/              — frozen dossier (see 4.4)
```

**Honesty rule**: the public `/audit` page labels every artifact *internal review / tool report / third-party audit*. Tool output is never called an audit. Known limitations are published.

### 4.2 Tool battery

| Tool | Target | Cadence |
|---|---|---|
| cargo scout-audit (CoinFabrik) | contracts/ | CI (PR + weekly) |
| cargo-audit + cargo-deny | Rust deps/licenses | CI |
| osv-scanner | Cargo.lock + package-lock | CI |
| clippy `-D warnings` | contracts/ | already CI; export as report |
| **Almanax** (Stellar agent) | contracts/ only — `mock_oracle/` + `oracle_adapter/` excluded (retired) | manual; Default mode for calibration, premium/deep runs reserved for the frozen rc. CI/CD integration OFF (write perms + per-push credit burn declined). Export PDF+JSON → `audit/tools/almanax/`. Ask SDF about SCF credits/Premium. |
| **Frontier-model review** (OpenAI API credits ~$2.5k, confirmed API-type) | frozen contracts tag | at freeze — independent-model pass to hedge Claude blind spots; small calibration run allowed earlier |
| Property/fuzz tests (proptest) | share math, funding, partial-liq | pre-freeze |
| Claude deep audit | full stack incl. new access surface | at freeze, before firm window |

CI workflow: `.github/workflows/security.yml` — PR + weekly; artifacts uploaded; new high-severity findings fail the run; everything triaged into the register.

### 4.3 Third-party

- Audit Bank application **submitted** ✅. Remaining: scoping call — core scope = market, vault, risk, router, shim (+ vault_factory/referral secondary), and **push Noeracle into the same scope** (decided). Firm audits the frozen rc tag from the mirror repo.

### 4.4 `release/v1/` frozen dossier

Commit + tag; per-contract WASM hashes (built + verified on-chain); addresses; config snapshot (`scripts/snapshot_config.ts` dumps all on-chain config to JSON); oracle trust-model doc (Noeracle S-1, publisher set, staleness/deviation/last-good); key-management doc (multisig setup + ceremony record); ops runbooks (pause, incident, oracle failover, upgrade procedure); risk-parameters rationale + wave schedule; known limitations; links to all reports.

### 4.5 Contracts mirror repo (`NoetherDEX/contracts`)

**CI-pushed release mirror, never hand-edited.** On tag `contracts-v*`: CI pushes contracts source + pinned toolchain (`rust-toolchain.toml`, stellar-cli version) + build recipe + hashes table, same tag. Wire StellarExpert's reproducible-build verification workflow in the mirror (details confirmed at implementation) so deployed contracts show "source verified". README maps tag ↔ WASM hash ↔ address ↔ audit report. **Before the mirror goes public: gitleaks sweep over full git history.** Monorepo remains the only dev home.

## 5. Workstream C — Launch readiness & release

### 5.1 Multisig (SEC-3 / P3-8)

- 2-of-3 on a fresh admin account; the **three new seed phrases Yahya generated** are the initial signers. Honest status for the dossier: *key-loss/theft protection, single custodian at launch; two-person control from Mert's return* — Mert generates his **own** key and swaps in for seed #3 (single `set_options` tx).
- Seed storage rules: three genuinely separate locations (never two in one password manager/device/cloud), ≥1 offline; none ever touches a server. Keeper/operational keys stay separate low-privilege hot keys.
- All contract admins + NOE issuer migrate to the multisig account. **Register item**: market exposes only the internal `set_admin` storage helper — add/verify a public `set_admin` entrypoint before freeze (vault, router, shim, risk, referral, factory already have one).

### 5.2 Launch parameters (proposals; finalized in the risk doc)

Start at wave-2 caps (decided), except leverage:

| Parameter | Launch (jury wave) | After soak | Public target |
|---|---|---|---|
| Max leverage | **5x** (matches jury script; one invoke to raise) | 10x | 25x (SCF deliverable) |
| Max position | $25k | $25k | $100k |
| Per-account deposit cap | $10k | $10k | raised/off |
| Vault AUM cap | $250k (actual AUM ~$1.5k — OI cap binds first) | — | raised/off |

### 5.3 Seed capital (decided, sized for max 2 juries + team)

- LP seed **$1,000–1,500** (→ ~$700–1,050 OI headroom at the 70% cap; never let AUM fall below ~$1k or the demo hits OI-cap errors).
- Insurance buffer **$200–300**.
- **Prefunded jury wallets**: 2 × (~100 USDC + a few XLM). Jurors trade 20 USDC @ 5x from the allowance; LP testing is **optional** and uses the allowance ($20–50), never their own money. NOE trustline step included in the jury script.
- All-in ≈ **$1.5–2k**, parked and mostly recoverable; earns fees. Fronted from currently available funds (T3 pays out after verification). Liquidity grant application proceeds in parallel and scales AUM for wave 2+.
- Jurors are never required to fund the pool (conflict of interest, day-one OI deadlock, on-ramp friction).

### 5.4 Freeze & audit sequencing

Freeze when the register clears → tag `contracts-v1.0.0-rc1`. Post-freeze, only audit-remediation commits (rc2…; final `v1.0.0`). Claude deep audit → fixes → clean tool re-runs → firm window → remediation → pin `release/v1/`. **Then** tranche submission with the report attached, then ceremony.

**Register (verify/clear at freeze)**: multisig migration incl. market `set_admin`; production oracle publisher set — resolve XLM (Stork entitlement or Reflector); L1-18 + keeper L0-19 leftovers; mainnet config (real Circle USDC, no faucet); global AUM cap; gitleaks history sweep; seed capital in hand.

### 5.5 Ceremony

1. **Rehearsal on testnet with the actual multisig** — deploy → hash-verify → init → seed → smoke trades. Mandatory before mainnet day.
2. Mainnet: multisig setup → upload/deploy audited WASM → **verify on-chain hashes match the dossier before init** → init + config → snapshot → seed vault + insurance → team smoke trades (open/close/liquidate, tiny sizes) → publish `/audit` page.

### 5.6 Infra topology

Duplicate Azure apps for mainnet (`noether-api-mainnet`, `noether-indexer-mainnet`, `noether-keeper-mainnet`) + new `noether_mainnet` database on the existing Postgres server; access tables copied at cutover. Testnet stack untouched — **testnet.noether.exchange stays live as the free playground with the mainnet waitlist CTA**.

### 5.7 Monitoring (minimum viable pager, before wave 1)

Azure Monitor alerts: keeper heartbeat absence/restart loop, oracle staleness (last push age), indexer cursor lag, gateway 5xx rate; daily bad-debt/insurance-drawdown report from the keeper reconcile duty. Email first; Telegram webhook optional.

### 5.8 Waves & go/no-go

- Wave 1 (jury): Yahya, Mert, ≤2 SCF juries, a few friendlies. ≥1 week soak. Then raise caps via invokes; wave 2 from the waitlist; public = `LAUNCH_GATE=0` when it's been boring.
- Go/no-go checklist (in new `docs/MAINNET-RUNBOOK.md`): register clear; dossier complete; firm report received + criticals fixed; monitoring live; ToS up; e2e access flow tested; seed deposited.

## 6. Testing

Contracts: existing suites + AUM-cap tests + property/fuzz on money math. Gateway: vitest — waitlist validation/idempotency/rate limits/Turnstile (mocked), admin authz matrix. Web: middleware cookie-v2 unit tests + Playwright e2e join→approve→unlock. Integration: the testnet ceremony rehearsal.

## 7. Non-goals (v1)

No on-chain identity allowlist, no KYC, no email marketing engine (CSV export only), no admin roles beyond `ADMIN_WALLETS`, no separate admin app, no immutability freeze, no bug bounty at launch (post-launch candidate), no Certora Sunbeam, no sign-to-join (sign-to-unlock only).

## 8. Open operator items

1. Reply to Ashley: confirm audit-first plan; ask for the **outer deadline** on tranche submission in writing.
2. Ask SDF about Almanax Premium/credits for SCF projects.
3. Verify SCF fund-use rules cover bootstrap liquidity/insurance seed.
4. Liquidity grant application follow-up.
5. Mert's return: generate own key on own device, signer swap for seed #3.
6. ToS content pass before public launch.
7. StellarExpert reproducible-build workflow details when wiring the mirror CI.
