# L0-18 operator draft — SCF Audit Bank application email

> Ready to send. Owner: Yahya. Cross-refs: TASKS P6-1 (trigger "Phases 1-2 complete" satisfied since 2026-07-04), docs/plans/P0-mainnet-gates.md L0-18. The 2-4 month scheduling lead is the mainnet critical path — send now; the requested start is post-Batch-1, so audit prep and Batch-1 development overlap instead of serializing.
>
> Attachments to include: docs/AUDIT-2026-06.md, docs/THREAT_MODEL.md, SECURITY.md (or repo links — the repo is public).

---

**To:** sorobanaudits@stellar.org
**Subject:** Audit Bank application — Noether (SCF #41), perpetual futures DEX on Soroban

Hi,

I'd like to apply for an Audit Bank engagement for **Noether**, a decentralized perpetual futures exchange on Soroban, funded under **SCF #41** (build tranches complete; the audit gates our mainnet launch).

**Project summary.** Noether is a vault-as-counterparty perp DEX: an LP pool (USDC) takes the other side of every trade at oracle price. Every order, match, funding application, and liquidation is an on-chain Soroban transaction — there is no off-chain matching to trust. Live on testnet since 2025 at https://noether.exchange (closed beta), currently 14 pairs, cross + isolated margin, partial liquidation, an insurance buffer, and a pull-oracle price stack (Noeracle) relayed atomically through a verify-then-trade router.

- Repo: https://github.com/NoetherDEX/noether (contracts in `contracts/`)
- Docs: https://docs.noether.exchange
- Team: Yahya Emir Soyer (CEO, contracts) + Mert Cicekci (CTO, full-stack)

**Requested scope** (Rust/Soroban, workspace `contracts/`):

| Crate | Role | Notes |
|---|---|---|
| `market` | trading engine: positions, orders, cross margin, funding, partial + full liquidation, ADL (new) | the core; ~70KB optimized WASM |
| `vault` | LP pool, NOE share token, PnL settlement, insurance buffer, solvency reservations | |
| `vault_factory` | user-created copy-trading vaults (leader proxies) | |
| `referral` | on-chain referral (discount/share accrual + claims) | |
| `noether_router` | atomic price-relay + trade (verify-then-trade), publisher allowlist, price bands | |
| `noeracle_shim` | SEP-40-style read adapter market→oracle | |
| `noether_common` | shared types/math/errors | |
| `risk` | per-asset risk config + funding velocity + ADL ranking | may ship as a deployed contract OR folded into `market` storage — we will confirm which at freeze; please scope for either |
| Noeracle oracle (separate repo) | pull oracle the stack prices from: publisher-signed batch writes, 2-of-3 quorum + median, price ring buffer/TWAP (new) | https://github.com/[NOERACLE-REPO] — small (~7KB WASM), 1 crate |

**Timing.** We are mid-way through a final pre-audit contract batch ("Redeploy Batch 1": solvency waterfall completion incl. ADL, per-market risk config, oracle hardening, pause semantics). We will **freeze the contract surface at a tagged commit once that batch verifies on our staging stack** and hand you the tag — nothing lands on the audited surface after the freeze. Our preference is to lock a start slot now for roughly **[4-8] weeks out** and confirm the frozen tag ahead of it; we're flexible on exact dates.

**What you get with the submission** (all in-repo today):

- **Internal audit**: docs/AUDIT-2026-06.md — an 87-finding internal security review with file:line evidence and a completed remediation sprint (2026-07-04).
- **Threat model**: docs/THREAT_MODEL.md (STRIDE, covering the oracle write path, keeper roles, and admin-key model).
- **Security policy**: SECURITY.md — disclosure policy with published reward bands, 72h ack SLA, SEAL 911 escalation.
- **Tests**: 167 contract tests (`cargo test --workspace`), 96 API + 33 indexer tests off-chain, an e2e testnet harness, plus reproducible builds (`contracts/Cargo.lock` tracked; cost-analysis snapshots in git). We will run `cargo scout-audit` and disposition its findings before handing over the freeze tag.
- **Deployment context**: blue-green staging + production stacks on testnet; the audited tag's rebuilt WASM hashes will be verified equal to the mainnet-deployed hashes.

We understand the engagement involves a refundable co-pay (~5%) — happy to proceed on that basis.

Anything else you need for scheduling — artifacts, a scoping call, read access — just say the word.

Thanks,
Yahya Emir Soyer
Co-founder & CEO, Noether — yahyaemir145@gmail.com · @Noetherdex

---

## Post-send tracking (edit inline)

- [ ] Sent on: ____
- [ ] Acknowledgment received: ____
- [ ] Scoping call: ____
- [ ] Scheduled window: ____ (feeds the L0-18 freeze timing)
- [ ] Before handover: cargo scout-audit run + findings dispositioned; `audit-freeze-1` tag pushed; CI freeze-guard active
