# Soroban Security Audit Bank — Noeracle form answers

> Prepared 2026-08-21 (separate application per Ashley's instruction; Noether's own
> answers live in `L0-18-audit-bank-form-answers.md`). Paste blocks contain no dash
> bullets and no em dashes (Airtable long-text rendering).
> Attachments: `~/Desktop/noeracle-og-image.png` (logo, 1200x630) and
> `~/Desktop/Stellar/Noeracle/THREAT_MODEL.md` (STRIDE, SDF template shape).

## Before you submit

1. Push the Noeracle repo so the link shows auditors the deployed code (the hardened
   branch was never pushed; public `main` is 9 commits behind production):
   `cd ~/Desktop/Stellar/Noeracle && git push -u origin feat/l08-l09-quorum-ring && git push origin HEAD:main`
2. Optional (10 min, strengthens the tooling answer): add `noeracle/noeracle` to Almanax
   and run a scan; then also tick Almanax in the tooling field.

## Project Information

Select your SCF Project: leave unselected or as the form allows (Noeracle is not an SCF project).
Project Name (if not SCF): `Noeracle`
Who at SDF have you been working with: `Ashley Wright`
Email: `yahyaemir145@gmail.com` · Telegram: `@y4hyaE , @merthxyz`
Type of Project: `Oracle` · Soroban Audit Bank #: `Initial Audit`
Project URL: `https://noeracle.org`
Link to Repo: `https://github.com/noeracle/noeracle`
Link to Docs: `https://docs.noeracle.org`
Project Logo: upload `~/Desktop/noeracle-og-image.png`

### What does your project do and what problem does it solve?

```
Noeracle is the first pull based price oracle on Stellar, built as the complement to
Reflector's push model. Publishers sign prices off chain every 500 milliseconds, and a
consumer fetches the freshest signed attestation and bundles the verification into its
own transaction. The Soroban contract verifies the publisher signature, enforces a 60
second staleness bound and a monotonic round id per asset, and stores the price, so the
consumer's logic executes against a price signed within the last second rather than
against pre warmed on chain state. An M of N quorum path stores the per publisher
median once several publishers are registered.

The problem: execution sensitive protocols such as perpetual DEXs, lending liquidations
and oracle priced AMMs need sub second freshness at the moment of execution, which a
push oracle bounded by ledger close time cannot give. Noether, our perpetual futures
DEX, is the first consumer and relays a Noeracle attestation inside every trade.
```

### What does your project's current traction look like?

```
Live on Stellar testnet since May 2026. The attestation service at api.noeracle.org
signs 15 USD pairs every 500 milliseconds from five exchanges and serves them over
HTTPS and SSE, with external uptime monitoring. The hardened contract (registered
publisher set, staleness bound, monotonic rounds, quorum median path, in place
upgrade) was deployed on 21 July 2026 and is the sole price source of the Noether
perpetual DEX on both its production and public testnet stacks: every Noether trade
since the June 2026 cutover has executed against a Noeracle signed price. Noether's
testnet has cleared over 400 million dollars in cumulative notional across more than
660 wallets on those prices.

Developer surface: the @noeracle/sdk package on npm integrates in under ten lines, a
reference Soroban consumer contract ships in the repo, and full documentation including
architecture and threat model is at docs.noeracle.org. The project was delivered at the
Istanbul Stellar hackathon in June 2026. It is not SCF funded; it is infrastructure
consumed by an SCF project (Noether, SCF 41), and it sits in the Oracle priority
category. Mainnet TVL is zero since we have not launched.
```

## Audit Information

Lines of Functional Code (excl. tests): `720`
(whole `oracle_v0/src/lib.rs`; about 150 of those lines are the feature gated benchmark
entrypoints that are absent from production builds. Methodology matches the Noether
application: file line count with test code excluded.)

Anticipated Audit Readiness Date: `08/31/2026` (aligned with Noether so one firm can scope both; the code is already frozen at the deployed commit).

Have you run your code: `Yes`

### Have you written and executed tests on your smart contract(s)?

```
Yes. 41 Rust tests on the oracle contract, all passing, plus 8 host cost harness tests
with committed ledger snapshots and 22 tests on the off chain attestation service's
aggregation logic.

The contract tests are behavioural: init cannot be claimed by a first caller, unknown
and duplicate publishers are rejected, batch length mismatches are rejected, rounds
older than 60 seconds are rejected, lagging and replayed rounds are silent no ops that
never regress a fresher price, the quorum path enforces its threshold and stores the
per asset median, the single publisher persistent path closes itself when the quorum
is raised above one and reopens at one, the history ring and the prices and twap views
behave as specified, and upgrade is admin gated.

The release profile compiles with overflow checks on and panic abort, so arithmetic
traps rather than wraps. CI runs the contract tests on every push. The same build is
deployed on testnet and has been consumed continuously by the Noether perp DEX since
July, and we verified on chain on 21 August that the live instance exposes exactly the
twelve hardened entrypoints and none of the benchmark only ones.
```

STRIDE Threat model: upload `~/Desktop/Stellar/Noeracle/THREAT_MODEL.md` (follows the SDF template: flow + diagram, threat table with IDs, remediation table, reflection; appendices carry scope, ranking, residual risks).

Security tooling: tick `Scout` (and `Almanax` only if you run it first, see above).

### Remediation / tooling detail box (next to the tooling tags)

```
Yes. We expect to remediate all critical, high and medium findings within the
program's 20 business day window; the contract is 720 lines and changes ship through
an admin gated upgrade entrypoint, so fixes land fast.

Tooling: we ran cargo scout audit 0.3.16 (CoinFabrik Scout, Soroban detector set)
against the full workspace at the deployed commit on 21 August 2026. Result: zero
detections on both crates. cargo audit is clean (warnings only for yanked transitive
crates). Both reports are in the repo under audit/. We treat a clean tool run as a
floor, not a ceiling: the items we want human eyes on are in the threat model,
namely the single publisher quorum of one, the missing domain separator in the signed
message, the absence of on chain events, and the TTL by writes storage model.
```

### Audit firm preference

```
Strong preference for the same firm that is matched to Noether, whichever that is:
Noeracle is Noether's sole price source, and the router to oracle boundary is exactly
where an oracle compromise would be monetized against Noether's liquidity vault, so
one firm seeing both sides is worth more to us than any individual firm choice.

If the two are matched separately, ranked: Veridise (Soroban specific tooling and
host level experience, which matters for a contract whose risk is signature, storage
and TTL semantics), Zellic (cryptography depth for the Ed25519 and quorum median
design), then OtterSec. We are flexible and defer to your matching.
```

### Additional notes

```
Four things up front.

1. Same team as Noether. Noether's Audit Bank application asked whether Noeracle could
be scoped in; Ashley asked us to file separately, which this is. We would still like
the two reviewed against each other at the router to oracle boundary.

2. Scope is small and frozen. One contract, 720 lines, 15 KB of WASM, twelve
entrypoints on the live instance, deployed on 21 July 2026 and unchanged since. We
will tag the audited commit and ship any fix through the upgrade entrypoint from a
hash verified build.

3. Two known open risks, disclosed deliberately and declared hard mainnet gates in
the threat model. First, the live instance runs with a single registered publisher
key at a quorum of one, so a publisher key compromise is a full oracle compromise;
the M of N median path is deployed and tested, and arming it waits only on
independent publishers existing. Second, a single admin account controls the publisher
set, the quorum and the upgrade path with no timelock; a multisig migration is planned
alongside Noether's. We would value the auditors' view on the designs of both fixes.

4. Design questions we would like answered: whether the signed message should gain a
network and contract domain separator before mainnet, whether the absence of on chain
events is acceptable, whether the median of rounds quorum is sound against a colluding
minority plus one stale honest publisher, and whether the twap view (a mean over
stored rounds, not time weighted) is safe to expose to lending style consumers.

The prior version of the public threat model at docs.noeracle.org describes the pre
hardening prototype; the attached document supersedes it.
```

Terms & Conditions: check the box (5 percent co pay, refundable on remediating
critical, high and medium findings within 20 business days).

## Source of the numbers (2026-08-21)

- LOC: `wc -l oracle_v0/src/lib.rs` = 720 (tests live in `src/test.rs`). Bench feature block spans roughly lines 469 to 615.
- Tests: `grep -c '#[test]'` → 41 (`oracle_v0/src/test.rs`), 8 (`bench/src/test.rs`); keeper `aggregate.test.mjs` 22.
- Live entrypoints: `stellar contract invoke --id CBTO5K2N… -- --help` on 2026-08-21; `get_quorum` = 1.
- WASM: `target/wasm32v1-none/release/noeracle_oracle_v0.wasm` = 15,312 bytes.
- Traction: Noether leaderboard gateway, all-time 664 traders / $401.1M notional (2026-08-21).
- Scout: `cargo scout-audit` 0.3.16 at `c9385b1`, 0 detections; cargo audit clean. Both saved under `Noeracle/audit/`.
- Firms: SCF Handbook official rules fetched 2026-08-21 (approved: Certora, Code4rena, ChainSecurity, Halborn, Oak Security, OtterSec, Runtime Verification, Spearbit + Cantina, Veridise, Zellic; probationary: Arda, Hacken, Sherlock, Quantstamp, Hashlock, Decurity, Adevar Labs, Bevor).
