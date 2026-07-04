# Security Policy

Noether is a perpetual-futures DEX on Stellar/Soroban. On testnet today; this
policy takes effect for real value at mainnet. We take solvency and oracle
integrity seriously and welcome coordinated disclosure.

## Reporting a vulnerability

**Do not open a public issue for a security bug.** Email **security@noether.exchange**
(or DM [@Noetherdex](https://twitter.com/Noetherdex)) with:

- a description and impact assessment,
- reproduction steps or a PoC (a testnet PoC is ideal — never test against
  mainnet with real funds),
- the affected contract/service and commit or address.

We acknowledge within **72 hours** and aim to triage within **5 business days**.
Please give us a reasonable window to remediate before any public disclosure.

For an active exploit in progress, also contact **SEAL 911** (free 24/7 whitehat
hotline): https://www.seal911.org.

## Scope

In scope: the on-chain contracts (`market`, `vault`, `vault_factory`,
`referral`, `noether_router`, `noeracle_shim`, `noether_common`), the API
gateway, the indexer, the keeper, and the web app's transaction-construction
path. The Noeracle oracle is a related project (SCF #44) — oracle write-path
issues are in scope and gate mainnet.

Out of scope: findings requiring a compromised user device or wallet; social
engineering; spam/DoS of the public testnet RPC; anything already listed as a
known issue in `docs/AUDIT-2026-06.md` or `TASKS.md` (e.g. the pre-hardening
Noeracle write path, O-1 — being fixed).

## Rewards (interim policy, pre-audit)

Until we list on Immunefi at meaningful TVL, rewards are discretionary and
scaled to severity and real impact:

| Severity | Example | Reward |
|---|---|---|
| Critical | direct theft / vault drain / oracle-forge into loss of funds | up to **10% of funds at risk, capped $10,000–25,000** |
| High | forced insolvency, bad-debt injection, auth bypass | $2,000–5,000 |
| Medium | griefing, DoS of liquidations, incorrect accounting | $500–2,000 |
| Low | info leak, minor misconfig | swag / acknowledgement |

Good-faith research under this policy will not be pursued legally. First
reporter of a unique, reproducible issue is eligible. We publish fixed critical
findings after remediation with credit (opt-out available).

## Our commitments

- Independent audit before mainnet (SCF Audit Bank scope includes Noeracle).
- Admin migrating to a 2-of-3 multisig; keeper/oracle keys separated from admin.
- The market ships an admin pause + upgrade path for incident response; see
  `docs/INCIDENT_RUNBOOK.md`.
