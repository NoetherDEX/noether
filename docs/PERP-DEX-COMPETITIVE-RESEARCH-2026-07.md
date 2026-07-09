# Perp DEX Competitive Research & Mechanism Recommendation

**Date:** 2026-07-09 · **Scope:** trading-mechanism landscape, mechanism recommendation for Noether, feature gap analysis, off-chain backend architecture.
**Method:** 8 parallel research passes over official docs, GitHub repos, incident postmortems, DefiLlama/CoinGecko APIs, and live Stellar mainnet network settings (queried via `stellar network settings` on 2026-07-08). Every metric carries a source and access date. Claims that could not be verified against a primary or two independent secondary sources are flagged **UNVERIFIED** rather than guessed. DefiLlama's volume/fees API went behind a paywall in 2026, so several point-in-time volumes come from CoinGecko's derivatives API (BTC-denominated, converted at BTC ≈ $62,250 on 2026-07-08) — treat exact volume levels as ±30%; rankings and orders of magnitude are corroborated.

---

## 1. Executive summary

**Recommendation: do not build a matching order book. Keep — and harden — the oracle-priced pool mechanism Noether already has.**

A close reading of our own `market` contract makes the strategic picture much simpler than the brief assumed: **Noether is not actually a CLOB today.** Every open, close, and trigger execution prices at the Noeracle oracle (`get_oracle_price` on all paths), resting "orders" are keeper-executed trigger orders, and the counterparty is pooled collateral backed by the NOE vault (unrealized-PnL pushes, 70 % reserve cap, loss-capped settlement). That is a GLP/JLP-family **oracle-priced pool** — which happens to be *the only mechanism class that provides full trading depth at zero liquidity*, and the one every serious cold-start comparison (GMX, Jupiter, Gains, Ostium, Levana) validates for our exact situation. The "order book is weak" problem is not an engineering gap to close; it is a UI presenting a mechanism we don't have. Meanwhile the physics are decisive: live Stellar mainnet settings cap a fully on-chain CLOB at **~35–50 order-operations/sec with ~5 s trade latency** (§5.2) — versus Hyperliquid at ~0.1 s and 200k orders/sec — and a hybrid CLOB at our size would be a ghost book that surrenders the fully-on-chain narrative without winning latency or liquidity.

The 2022–2026 incident record (§4) converts directly into our hardening checklist: oracle-pool protocols die from **zero-slippage manipulation on thin markets** (GMX v1 AVAX), **stale-price sniping** (Levana), **keeper/privileged-setter compromise** (KiloEx), **vault-accounting reentrancy** (GMX v1 2025), and **LP-vault variance in trending markets** (JLP/gDAI) — every one of which has a known, implementable mitigation, several of which we already shipped in the audit sprint.

**Top-5 action items (priority order):**

1. **Per-asset OI caps sized to oracle-moving liquidity + a price-impact/skew fee** (deferred P5-1 RiskConfig is now launch-blocking). Rule of thumb from the attack-cost math (§4.8): max net OI per asset must cost more to exploit than to move the reference market — pure zero-slippage execution is a standing free option on thin pairs (ZEC, TRX at our size). Effort: M.
2. **Skew-scaled funding + borrow fee and an insurance buffer tier between trader PnL and vault principal** (Ostium's two-tier design is the model; our 70 % reserve cap is a blunter version). Protects NOE LPs from the JLP/gDAI drawdown pattern and makes the vault sellable. Effort: M.
3. **Replace the fake order-book UI with an honest depth/impact display** and reposition the product as "oracle-priced perps with on-chain settlement" — stop competing on a claim (CLOB) we can't defend and don't need. Effort: S.
4. **Build the indexer-first backend** (dYdX-v4-shaped, right-sized: RPC ingestion → Postgres → Redis → REST/WS; §6) and eliminate every direct chain read in the web app — the N+1 `get_order` pattern in the order book view is the worst offender. Effort: M–L (mostly extends what exists).
5. **Launch mainnet with 4–6 deep pairs, not 14** (BTC/ETH/XLM/SOL/XRP; keep thin pairs testnet-only or behind tight caps), with a small capped vault ($250k–$1M), real-yield fee share to NOE LPs (the GLP/JLP 63–75 % pattern), and MM/points spend deferred until the mechanism is proven. Effort: S (config + ops).

**What we lean into:** near-zero, deterministic fees (~$0.004/tx — though note zero *trading* fees are now table stakes at Lighter/Paradex, so the pitch is "no gas + low fees + real yield"); full on-chain verifiability of settlement (stronger than every off-chain-matched competitor except Lighter's zk-proven matching); first-mover on Stellar with its USDC/anchor/on-ramp rails — and, longer-term, the FX/RWA angle Stellar's anchor network is uniquely suited to (Ostium proved the niche: $171M OI on RWA perps).

---
## 2. Task 1 — Mechanism landscape

Taxonomy used throughout: **(A) fully on-chain CLOB** (matching inside consensus), **(B) off-chain CLOB + on-chain settlement** (incl. zk-proven variants), **(C) oracle-priced liquidity pool** (GMX-style; LP vault is counterparty), **(D) vAMM** (virtual liquidity), **(E) synthetic debt pool** (stakers are counterparty), **(F) hybrid/other** (JIT auctions, netting engines, RFQ/dealer).

### 2.1 Hyperliquid — (A) fully on-chain CLOB
- **Mechanism:** Order placement, matching, cancels, funding, margin, liquidations and settlement all execute inside **HyperCore**, a purpose-built state machine baked into the L1 (not a smart contract). Matching is deterministic price-time priority run identically by every node — the exchange *is* the chain's state-transition function. Oracles are used only for funding/margining, never for trade pricing.
- **Chain & infra:** Bespoke appchain; **HyperBFT** (HotStuff-derived), one-block finality, consensus median ~0.1 s (p99 ~0.5 s), end-to-end order ~0.2 s; claimed ~200k orders/s. Bridged USDC from Arbitrum (+ native USDH since Sep 2025). HyperEVM shares the state root for composability (HIP-3 builder markets).
- **Positives:** CEX-grade microstructure with on-chain verifiability; gasless orders/cancels; HLP backstop absorbs liquidations; every order public (the Oct 2025 crash postmortems were possible only because of this).
- **Negatives:** JELLY (2025-03-26): HLP inherited a manipulated toxic short, validators voted to force-settle at $0.0095 vs ~$0.50 oracle — "decentralization" overridden ad hoc. HLP drawdowns (2025-03-12: ~$4M from a 50x whale's margin-withdrawal loophole → leverage cut to 40x BTC/25x ETH). Oct 10–11 2025 cascade: force-closed >$10B, ~6,300 wallets, first ADL in 2 years, HLP *profited* ~$40M ("house wins" critique). Closed-source node binary; Foundation holds ~80 % of staked HYPE; POPCAT spoof-cascade (Nov 2025) cost HLP ~$4.5–4.9M.
- **Bootstrapping:** No VC, no MM deals (stated). (1) **HLP** — protocol-owned MM+backstop vault quoting every market from day one; (2) points (Nov 2023→); (3) HYPE genesis airdrop 2024-11-29 (~31 % of supply); (4) fee recycling into HYPE buybacks. HLP cumulative profit ~$137M since May 2023 (CoinGecko Learn, 2026-07-08).
- **Metrics (2026-07-08):** volume **$6–10B/day** (sources conflict: CoinStats ~$6.5B; CoinGecko ~$10.2B; BlockEden ~$180B/mo) ≈ 70 %+ of DEX perp share; OI $3.5–10B (conflicting, exact UNVERIFIED); HLP TVL ~$600M–1B; protocol TVL $6.07B (api.llama.fi/tvl/hyperliquid). Fees: base **4.5 bps taker / 1.5 bps maker** → 2.4/0.0 at top tier, HYPE discounts 5–40 % (docs, verified).

### 2.2 dYdX v3 — (B) off-chain CLOB + StarkEx settlement — *defunct Oct 2024*
- **Mechanism:** dYdX Trading Inc. ran a closed-source matching engine on AWS; matched trades batched into StarkEx (ZK validity rollup on Ethereum). Self-custody via forced L1 withdrawal; matching/censorship fully at operator discretion.
- **Positives:** CEX UX + validity-proof settlement; dominant 2021–22 perp DEX.
- **Negatives:** centralized matching (geo-blocks, black-box priority); reward-gamed volume; fees accrued to the company, not the token. Died of strategy (v4 migration), not exploit; TVL ~$100M at wind-down (The Defiant, 2024-10).
- **Bootstrapping (canonical cautionary tale):** 3.84M DYDX per 28-day epoch pro-rata to fees+OI made it instantly #1 by volume; emissions cut −25 % (DIP 16) then −⅓ (DIP 29); LP rewards ~1.15M DYDX/epoch to scored MMs, cut 50 %. **Emission-bought volume left when emissions fell.**
- **Metrics:** zero (defunct).

### 2.3 dYdX v4 (dYdX Chain) — (F) validator-run in-memory book + on-chain settlement
- **Mechanism:** Every validator/full node keeps the book **in memory, off-consensus**; orders gossip but never land in blocks. The rotating **block proposer matches** against its local book and includes only *fills* in the proposed block; consensus finalizes fills/positions/funding. Decentralized matching without per-order consensus cost.
- **Chain & infra:** Sovereign Cosmos-SDK appchain, CometBFT, ~1 s blocks, ~2k TPS target; USDC via Noble/IBC; validator oracle (Slinky) for margining.
- **Positives:** no single matching company; fully open-source stack (protocol → indexer → frontend — see §6); gasless orders; maker rebates to −1.1 bps; 50 % of protocol revenue to MegaVault depositors; permissionless listings (172+ markets).
- **Negatives:** proposer-inclusion MEV (dashboard + social slashing only); ~1 s latency floor → thinner books than HL; **competitive collapse: ~$81M/day vs Hyperliquid's ~30× more** (CoinGecko 2026-07-08; Coin Metrics); persistent incentive dependence.
- **Bootstrapping:** $20M DYDX launch incentives administered by Chaos Labs **with wash-trading detection**; MegaVault (HLP-imitation) seeds quotes on every market; zero-fee promos through 2026.
- **Metrics (2026-07-08):** 24h volume ~$81.4M, OI ~$48.3M (CoinGecko dydx-chain); TVL UNVERIFIED (low hundreds $M historically). Fees taker 5.0→2.5 bps, maker 1.0→−1.1 bps (docs, verified).

### 2.4 GMX v1 (GLP) — (C) oracle pool, zero slippage — *deprecated after Jul 2025 exploit*
- **Mechanism:** perps + swaps against the multi-asset **GLP** house pool at pure oracle price (Chainlink + keeper-signed fast feed), **zero price impact at any size**; GLP is universal counterparty; borrow fee only, no long/short funding.
- **Positives:** instant depth from day one, no MMs; GLP earned 70 % of fees — the original "real yield".
- **Negatives:** the two canonical oracle-pool failures. **2022-09-18 AVAX manipulation:** ~5 push-close cycles against zero-impact fills extracted ~$565k → fix was OI caps. **2025-07-09 cross-contract reentrancy:** corrupted global average-short-price/AUM, GLP mark inflated, **~$40–42M** drained (attacker returned ~$37.5M under a 10 % whitehat deal; ~$44M compensation plan). Zero-slippage structurally invites latency arbitrage.
- **Bootstrapping:** esGMX emissions (1-yr vest) + multiplier points + 70 % fee share → GLP >$400M.
- **Metrics (2026-07-08):** TVL $2.8M residual; volume ≈ nil (DefiLlama gmx-v1-perps). Historical fees 10 bps open/close + utilization borrow.

### 2.5 GMX v2 (GM pools) — (C) oracle pool with price impact
- **Mechanism:** per-market isolated **GM pools** as counterparty; execution at **Chainlink Data Streams** price **plus a price-impact term on OI imbalance** (deliberately abandoning zero slippage) **plus funding between longs/shorts to balance OI** + borrow fees. The direct design answer to the 2022 attack class.
- **Chain & infra:** Arbitrum, Avalanche, Botanix, GMX-Solana, MegaETH; LayerZero "Multichain" access from Base/BNB/Ethereum (late 2025). Two-step keeper execution; 1.2 % of fees pay Chainlink.
- **Positives:** oracle liquidity without MMs; isolated LP risk per market; impact+funding tax toxic one-sided flow; LPs earn 63 % of fees.
- **Negatives:** LPs still counterparty to trader PnL; OI caps bound whales; ~20× outcompeted by Hyperliquid on flow.
- **Bootstrapping:** Arbitrum STIP 12M ARB (Nov 2023: ~6M GM liquidity incentives, ~6M trading rebates); 63 % fee share; buyback-funded staking.
- **Metrics (2026-07-08):** TVL $173.1M; fees $55.0k/24h, $1.80M/30d (api.llama.fi); open/close 4 bps (OI-balancing) / 6 bps (imbalancing) + impact; daily volume UNVERIFIED (paywall; 30d fees imply ~$100M/day order of magnitude); lifetime $345B+ volume.

### 2.6 Jupiter Perps (JLP) — (C) oracle pool, borrow-based
- **Mechanism:** fills at oracle price against the **JLP** basket (SOL/ETH/wBTC/USDC/USDT). Primary oracle **Edge by Chaos Labs**, Chainlink+Pyth fallback (2-of-3 failure halts). Traders *borrow the underlying* from the pool and pay an hourly utilization borrow fee; **no long/short funding**. Zero-impact model amended June 2024 with a price-impact fee simulating book depth.
- **Chain & infra:** Solana; Jupiter-operated keepers execute requests; Edge migration cut staleness events ~70 %.
- **Positives:** the only oracle pool still at scale; 75 % of all fees stream to JLP ("index + real yield" flagship); bootstrapped off Jupiter's aggregator funnel, no emissions ever.
- **Negatives:** LPs structurally short trader positioning (OI ~90 % long historically); traders netted +$6.85M over one 3-month stretch; JLP max drawdown −18 % (2024-08-05, BidClub); only 3 tradable assets; Jupiter/Chaos-centralized keepers + primary oracle.
- **Metrics (2026-07-08):** JLP TVL ~$705.6M; volume $529.9M/24h, $22.7B/30d (DefiLlama); OI ~$68.7M (precision UNVERIFIED); fees 6 bps base open/close + impact + hourly borrow.

### 2.7 Gains Network gTrade — (C) oracle pool, synthetic breadth
- **Mechanism:** fully synthetic perps at oracle price against **gToken vaults** (one vault per collateral backs *all* ~130–290 pairs — crypto, FX, commodities, stocks, indices, up to 500x "DEGEN"). Custom Chainlink DON priced on demand per execution. Not zero-slippage: fixed spread + depth impact + skew impact.
- **Positives:** extreme capital efficiency (one vault backs everything); widest breadth; live since 2021 — the design's originator.
- **Negatives:** net trader wins drain gDAI; if the vault goes under-collateralized **GNS is minted as backstop** (dilution risk; capped 0.05 %/day). Verified stress: May 2022 (LUNA era) DAI-vault under-collateralization forced reward redirection. The oft-cited "Jan 2023 attacker event" is UNVERIFIED (official recap shows no incident). Forex off-hours manipulation is a live vector, mitigated by spreads + per-pair OI caps.
- **Bootstrapping:** gDAI real-yield narrative; fee split 76 % DAO / 15 % LPs / 5 % referral / 4 % keepers; $10.8M revenue burned 2025.
- **Metrics (2026-07-08):** TVL $12.75M; ~$29.4M/24h, OI ~$4.7M (CoinGecko, approx); fees per side: BTC/ETH 35 bps, alts 50–60, forex 12–20 + borrow-per-block.

### 2.8 Ostium — (C) oracle pool, RWA-specialized, two-tier LP
- **Mechanism:** oracle perps on RWAs (proprietary pull oracle with Stork; top-of-book bid/ask + market open/close metadata on-chain) and crypto (Chainlink Data Streams). Dynamic spreads: 0 % below a net-flow threshold, spread+impact beyond. **Counterparty is two-tier: a Liquidity Buffer absorbs trader PnL first; the OLP market-making vault becomes counterparty only when collateralization <100 %** and earns fees otherwise. Daily PnL settlement.
- **Chain & infra:** Arbitrum; Gelato keepers; off-chain institutional LPs incl. Jump (The Block, 2025).
- **Positives:** proved the RWA-perps niche (71 pairs: 33 stocks, 6 ETFs, 7 commodities, 7 indices, 9 FX, 9 crypto); the buffer tier is the **best current answer to GLP-style raw LP exposure**; no close fee (~4 bps open, non-crypto).
- **Negatives:** young (early 2025); weekend gap risk on RWA perps; proprietary oracle trust; pre-TGE opacity. No exploit found (2026-07-08).
- **Bootstrapping:** no token yet — Points S2 (Jan 2026→) convertible to future $OST; OLP ~53 % APY during S2; 30 % of open fees to OLP.
- **Metrics (2026-07-08):** TVL $54.98M; **OI ~$171.5M vs ~$9.1M/24h volume** — distinctive high-OI/low-churn RWA profile; cumulative volume $23.7B vs >$33B (conflicting, UNVERIFIED).

### 2.9 Levana — (C) oracle pool, fully-funded — *dead (shutdown flagged 2026-01-26)*
- **Mechanism:** "well-funded perps": every position's max payout locked upfront from the LP pool (no socialized loss/ADL); Pyth pull oracle; skew side pays delta-neutrality + borrow fees.
- **Negatives:** **Dec 2023 staleness attack:** attackers congested Osmosis (fee-market bug) to block Pyth updates, traded stale prices for 13 days, drained ~$1.1–1.14M. Capital-inefficient by construction; never reached scale. LVN→RUJI merge (to Apr 2026).
- **Lesson:** a pull oracle is only as fresh as the last update you can *land on-chain* — hard staleness bounds must halt execution.

### 2.10 Aevo — (B) off-chain CLOB + OP-Stack rollup settlement
- **Mechanism:** off-chain book + risk engine; only matched trades settle on a custom OP-Stack L2 (optimistic, *not* validity proofs). Unified margin across perps + options (Ribbon lineage).
- **Negatives:** weakest settlement guarantees of the off-chain-CLOB cohort; Feb–Mar 2024 wash-trading scandal around its airdrop (options volume $100M→$4.56B→<$50M); AEVO −99.5 % from ATH; effectively lost the perp war.
- **Metrics (2026-07-08):** 24h volume ~$5.4M, OI ~$9.1M (CoinGecko); TVL ~$15.7M; fees 5 bps maker / 8 bps taker (expensive vs peers).

### 2.11 Paradex — (B) off-chain CLOB + Starknet-appchain validity proofs, privacy
- **Mechanism:** off-chain matching, settlement on a private Starknet appchain (STARK proofs to Ethereum); positions/PnL encrypted on-chain; 2026 "Grinta" upgrade begins decentralizing sequencing.
- **Positives:** strongest settlement+privacy story; Paradigm-backed; 0 % retail fees; perps + options.
- **Negatives:** the worst post-airdrop cliff measured in this study: ~$3B/day (Jan 2026) → ~$276M/day at DIME TGE (Mar 2026) → **~$8.9M/day now (>95 % collapse)**; OI $541M→$9M. Privacy also blunts public-verifiability marketing.
- **Bootstrapping:** XP program explicitly rewarding *quote quality* (MM incentive) + vault deposits; DIME TGE 2026-03-05 (25 % supply to farmers, 2-week claim window).
- **Metrics (2026-07-08):** 24h volume ~$8.9M (CoinGecko; lower bound), OI ~$9.0M; TVL UNVERIFIED; fees 0/0 retail.

### 2.12 Lighter — (B) **zk-proven matching** + Ethereum settlement
- **Mechanism:** the strongest verifiability design in market: an app-specific zk-rollup where **the matching engine itself is proven** — price-time priority, margin checks, funding and liquidations are ZK circuits; every batch posts a SNARK to Ethereum. The operator cannot mis-match, reorder for profit, or run invalid liquidations.
- **Positives:** zero retail fees; #2–3 perp DEX by volume through 2026; a16z/Lightspeed $68M at $1.5B; comparatively rigorous sybil filtering; circuits open-sourced Dec 2025.
- **Negatives:** **2025-10-11 outage:** the single sequencer died under 79.8× load during the $19B market-wide cascade — multi-hour downtime, users locked out, LLP −5.35 %. **ZK proves correctness, not liveness.**
- **Bootstrapping:** invite-only scarcity → points (Sharpe-weighted, sybil-filtered) → **LLP house pool that once carried ~80 % of maker share, now ~7 % backstop** as external MMs onboarded → LIT TGE 2025-12-30 → buyback-burn from revenue (Jul 2026).
- **Metrics (2026-07-08):** 24h volume ~$1.45B (CoinGecko), OI ~$793M, TVL ~$487M, 30d ~$39B (approx); fees 0/0 standard, HFT tier ~0.2/2 bps.

### 2.13 edgeX — (B) off-chain CLOB + StarkEx settlement
- **Mechanism:** centralized matching (claimed 200k orders/s, <10 ms) + StarkEx validity-proof settlement with escape-hatch self-custody — the dYdX-v3 pattern, revived.
- **Positives:** **Amber Group incubation solved cold start with in-house institutional market making**; mobile-first; post-TGE 100 % of net profits to daily EDGE buyback; genuine volume winner of the 2025–26 "perp DEX wars".
- **Negatives:** least decentralized of the cohort (closed matching, no decentralization roadmap); house-MM conflict-of-interest questions; points-heavy volume character.
- **Metrics (2026-07-08):** 24h volume ~$137M (CoinGecko — likely undercounts; multi-$B days reported early 2026, FLAGGED), OI ~$329–428M; fees 1.2 bps maker / 3.8 bps taker.

### 2.14 ApeX Omni — (B) off-chain CLOB + zkLink multichain settlement
- **Mechanism:** Bybit-lineage off-chain matching; settlement on zkLink X (ZK L3 aggregating deposits from Ethereum/BNB/Arbitrum/Base/Solana). Not verifiable matching.
- **Positives:** multichain deposit UX without bridging; Bybit distribution; zero maker fee; Polymarket orderbook integration (2026-06-01); 50 % of fees → weekly APEX buybacks.
- **Negatives:** vol/OI ≈ 10× ($1.07B vs $107M) — highest ratio in this study, consistent with wash-farming critiques (FLAG); zkLink dependence.
- **Metrics (2026-07-08):** 24h volume ~$1.07B (wash caveat), OI ~$107M; fees 2 bps maker / 5 bps taker.

### 2.15 Drift → Velocity — (F) hybrid JIT auction + keeper-cranked DLOB + AMM backstop — *halted since 2026-04-01*
- **Mechanism:** three cascading liquidity sources: (1) **JIT auctions** — taker orders run a short reverse-Dutch from oracle price, MMs race to fill; (2) **DLOB** — limit orders live on-chain but the *book* is reconstructed off-chain by permissionless keepers who crank fills for on-chain settlement; (3) AMM backstop if the auction lapses. v1 was a pure vAMM (retired after the 2022-05-11 incident: PnL-banking bug + Luna crash → bank run, $14.5M shortfall). Swift (Mar 2025) added gasless off-chain signed orders; v3 (Dec 2025) hit ~400 ms in-slot fills.
- **Status:** **2026-04-01: ~$285M drained (>50 % of TVL)** — six months of social engineering against the Security Council, Solana durable-nonce abuse to collect pre-signed txs, a worthless "CVT" token whitelisted as collateral. Attributed to Lazarus/DPRK (Chainalysis, Elliptic, TRM). Rebranded **Velocity DEX** 2026-07-01; relaunch backed by a $127.5M Tether credit line, USDT replacing USDC. Note carefully: **the failure was governance-key risk, not the matching design.**
- **Bootstrapping:** JIT auctions (MM-first fills), insurance-fund staking, FUEL points, staking fee discounts.
- **Metrics (2026-07-08):** volume ~$0 (halted); pre-exploit ~$550M TVL, >$133B cumulative.

### 2.16 Vertex — (F) off-chain sequencer + on-chain risk engine — *defunct Jul 2025*
- **Mechanism (historical):** centralized Rust sequencer matching at ~5–15 ms; positions/collateral/margin checks on-chain (Arbitrum); AMM liquidity interleaved into the book as resting orders; graceful degradation to pure AMM if the sequencer halted; "Edge" ran one synchronous book across 5+ chains.
- **Outcome:** acquired by Kraken's Ink Foundation (Jul 2025); all EVM deployments wound down; VRTX sunset at ~−98 % (holders got 1 % of INK supply). **The headline risk case for "off-chain sequencer + on-chain risk engine": the company is the protocol.**
- **Metrics (2026-07-08):** TVL ≈ $0 (api.llama.fi/tvl/vertex-edge).

### 2.17 Injective / Helix — (A) fully on-chain CLOB via chain module + Frequent Batch Auctions
- **Mechanism:** the order book lives in the chain's native Cosmos `exchange` module (consensus-level, not contracts). Matching is **per-block Frequent Batch Auctions clearing at a single uniform price** — front-running/MEV mitigation by design. Helix is the dominant relayer frontend (40 % fee-recipient share).
- **Positives:** the most decentralized matching model measured here; FBA's uniform clearing is real anti-MEV; 60 % of fees burned via weekly INJ auction.
- **Negatives:** chronic trade-and-earn volume inflation critiques; astonishingly thin on-chain TVL (chain ~$7.8M, Helix app ~$0.8M) — depth is professional MMs quoting via API, not organic capital; relayer concentration.
- **Metrics (2026-07-08):** fees maker −0.5 to −1 *deci*-bps rebate / taker 5 bps tiered; daily volume/OI UNVERIFIED (paywalls). **Relevance to Noether: Injective proves per-block batch-auction CLOBs work — but only with a dedicated L1 at sub-second blocks and paid professional MMs.**

### 2.18 MYX Finance — (F) oracle-priced peer-to-peer netting (MPM) + pool backstop
- **Mechanism:** no order book — longs and shorts net against each other at oracle price (zero slippage); pooled LP capital is counterparty only for the residual imbalance; funding nets the sides. Keyless/gasless AA UX; V2 permissionless listings (2026-06-12).
- **Negatives (verified):** Sept 2025 airdrop scandal — Bubblemaps traced ~100 fresh wallets claiming ~1 % of supply (~$170M at peak) to a deposit address associated with the project creator; MYX pumped ~1,400 % on low float then collapsed >95 %; OI $182M → ~$26M. Credibility gone; the *netting mechanism itself* remains interesting.
- **Metrics (2026-07-08):** TVL ~$140k (adapter-scoped, suspicious); volume/OI UNVERIFIED/disputed.

### 2.19 Aster — (F) dual-mode: centralized CLOB + oracle-pool "1001x" mode
- **Mechanism:** Pro mode = centralized off-chain matching with on-chain non-custodial settlement (BNB); Simple mode = fully on-chain oracle execution against the ALP pool. Own ZK "Aster Chain" mainnet claimed 2026-03-16.
- **Negatives (verified):** 2025-10-05 — DefiLlama **delisted Aster's perp volume** after 0xngmi showed per-pair volumes correlating ~1:1 with Binance's (Hyperliquid's decorrelate) and Aster declined to provide fill data; Rh points paid for raw volume **and liquidations** — a direct wash incentive.
- **Positives:** CZ/YZi distribution; TVL ~$787M is real (api.llama.fi); 99 %-of-fees buyback.
- **Metrics (2026-07-08):** TVL ~$787M verified; self-reported $1.75B/day volume / $1.91B OI **disputed**; fees 1 bp maker / 3.5 bps taker.

### 2.20 Pacifica — (B) off-chain CLOB + on-chain Solana settlement
- **Mechanism:** sub-20 ms off-chain matching; settlement, custody and accounting fully on-chain on Solana; Ed25519-signed CEX-style APIs; multi-source oracle mark (3 s refresh) for margining.
- **Positives:** ex-FTX COO founding team, self-funded; flipped Jupiter/Drift to #1 Solana perp venue by volume (~Sep 2025); >$100B cumulative by early 2026; post-Drift-hack it is Solana's flagship.
- **Negatives:** invite-gated; deliberately opaque points ("there is no airdrop"); centralized matcher.
- **Metrics (2026-07-08):** TVL $27.1M verified; >$1B/day + OI ~$69M as of Apr 2026 (current UNVERIFIED); fees 1.5/4.0 bps → 0/2.8 VIP.

### 2.21 Extended (ex-X10) — (B) off-chain CLOB + Starknet validity-proof settlement
- **Mechanism:** <100 ms off-chain matching; STARK-proven on-chain settlement with self-custody; migrated StarkEx → Starknet mainnet 2025; roadmap: decentralized sequencing appchain where validators run the matching logic under BFT.
- **Positives:** cleanest verifiable-settlement story of the new cohort; TradFi multi-asset margin (FX, gold, S&P 500, oil; 100+ markets); #1 Starknet app by TVL; no incidents found.
- **Metrics (2026-07-08):** TVL $136.2M verified; ~$27.2B/mo (~$0.9B/day), OI >$72M (secondary, approx); fees 0 maker / 2.5 bps taker.

### 2.22 Synthetix Perps — (E) synthetic debt pool → *exited the model*
- **Mechanism (historical):** SNX stakers mint sUSD and collectively hold pooled debt = counterparty to all trader PnL; Perps V2 added oracle execution + **skew-based funding and premium/discount** pushing the pool delta-neutral (an elegant primitive, widely copied — including conceptually by our own funding design).
- **Outcome:** SIP-420 (2025) broke sUSD's peg incentive → depeg to $0.68 (2025-04-18) → SIP-423 retired sUSD. All L2 deployments deprecated; current product is an **off-chain-matched CLOB on Ethereum mainnet** (public Dec 2025) with an SLP maker vault. **The debt-pool model's originator abandoned it.**
- **Metrics (2026-07-08):** 24h volume ~$4.8M, OI ~$2.0M (CoinGecko); TVL methodology-dependent.

### 2.23 Kwenta / Polynomial — frontends-on-shared-liquidity — *absorbed / pivoted*
- **Kwenta:** frontend on Synthetix; briefly out-traded GMX weekly mid-2023 on 330k OP/week incentives; volume was incentive-elastic; acquired by Synthetix Dec 2024 (KWENTA→SNX 1:17). **Lesson: a frontend on someone else's liquidity has no moat.**
- **Polynomial:** frontend → own OP-Superchain rollup; markets a **pool-for-thin-markets → graduate-to-orderbook** hybrid (conceptually the same phased path we recommend in §3); TVL $4.75M (2026-07-08); sub-scale.

### 2.24 Perpetual Protocol — (D) vAMM — *dead; the model's obituary*
- **v1:** the original vAMM; CREAM liquidation cascade (May 2021) nearly drained the insurance fund → halt, wind-down. **v2 "Curie":** vAMM with real makers on Uniswap v3 — makers' virtual inventory becomes a leveraged directional position against informed takers ("impermanent position"); LP returns structurally negative; the team ended up supplying most liquidity itself. Late 2025/early 2026: v2, Hot Tub and the Nekodex pivot all sunset; Binance delisted PERP 2025-11-12.
- **Metrics (2026-07-08):** volume $0, 0 pairs; TVL $426k. **No new design should be a vAMM.** Drift retiring its v1 vAMM (2022) and keeping it only as a backstop *component* is the surviving lineage.

### 2.25 Other models worth one paragraph
- **Variational** — RFQ/single-dealer: retail flow routes against one professional hedging dealer (Omni Pool); $50M raise May 2026 (Dragonfly); 24h volume ~$749M, OI ~$831M (CoinGecko 2026-07-08, own materials cite ~$552M — ±30 %). The successful successor to "protocol as counterparty": **a hedging dealer instead of a passive pool.**
- **Symmio** — intent-based bilateral RFQ (no pooled risk); powers IntentX, Pear; TVL ~$3.2M — conceptually elegant, commercially small.
- **Avantis** — Base oracle pool; pioneered junior/senior LP tranches (merged into one avUSDC vault Oct 2025); TVL $30.6M; the "positive slippage for skew-reducing trades" carrot is worth copying.
- **HMX** — oracle pool that rehypothecated GMX liquidity; wound down, team pivoted to a CLOB (DESK, Jun 2025); TVL $0.25M.
- **Contango** — "perps without perps" via money-market looping; no counterparty pool at all; capacity-bound by lending depth.
- **Hibachi / GRVT** — off-chain CLOBs with zk settlement + privacy (encrypted Celestia DA / validium); institutional-leaning.
- **Backpack** — regulated *CEX* with Solana ties; included only as the baseline hybrids compete against (futures ~$119M/day, OI ~$80.8M, CoinGecko 2026-07-08).

### 2.26 Comparison matrix

Cold-start friendliness = how well the mechanism functions at near-zero liquidity without paid MMs. Infra = what the mechanism minimally requires. Decentralization grades matching + settlement + custody.

| Protocol | Mechanism | Cold-start | Infra requirement | Decentralization | Status 2026-07 |
|---|---|---|---|---|---|
| Hyperliquid | (A) on-chain CLOB in consensus | ✗ needed HLP house pool | bespoke L1, ~0.1 s BFT | Medium (closed binary, Foundation stake) | Dominant ($6–10B/d) |
| dYdX v4 | validator in-memory book | ✗ $20M incentives + MegaVault | Cosmos appchain, ~1 s | Medium-high | Fading (~$81M/d) |
| Injective/Helix | (A) on-chain FBA module | ✗ paid OLP makers | own L1, sub-second | High (matching) | Niche |
| Lighter | (B) zk-proven matching | ✗ LLP house pool seeded 80 % | zk prover + sequencer | Medium (verifiable, not live-resilient) | #2–3 (~$1.45B/d) |
| edgeX / ApeX / Pacifica / Extended / Paradex / Aevo | (B) off-chain CLOB + proofs | ✗ affiliated/paid MMs + points | matching servers + rollup | Low-medium | Mixed (points-cyclical) |
| dYdX v3 | (B) trusted matcher + StarkEx | ✗ emissions | AWS matcher + StarkEx | Low (matching) | Dead |
| GMX v2 | (C) oracle pool + impact | **✓ full depth at $0 liquidity** | oracle feed + keepers | Medium-high | Alive ($173M TVL) |
| Jupiter | (C) oracle pool (borrow) | **✓** | oracle + keepers | Medium (operator keepers) | At scale ($706M pool) |
| Gains | (C) oracle pool (synthetic) | **✓** | oracle DON + keepers | Medium | Diminished |
| Ostium | (C) oracle pool, 2-tier LP | **✓** | oracle + keepers | Medium | Growing niche ($171M OI) |
| Levana | (C) fully-funded oracle pool | ✓ (but capital-hungry) | Pyth + cranks | Medium | Dead (staleness attack) |
| Drift/Velocity | (F) JIT + keeper DLOB + AMM | Partial (vAMM backstop) | Solana + keeper mesh | Medium-high | Halted ($285M hack) |
| Vertex | (F) sequencer + on-chain risk | ✗ | company-run sequencer | Low | Dead (acquired) |
| MYX | (F) oracle netting + pool | ✓ mechanically | oracles + AA infra | Low | Credibility-dead |
| Variational | (F) RFQ dealer | ✓ (dealer capital) | professional dealer | Low | Growing |
| Synthetix | (E) debt pool | ✓ mechanically | oracle + stakers | Medium | Model abandoned |
| Perp v2 | (D) vAMM | ✓ mechanically | oracle + insurance fund | Medium | Dead |
| **Noether (today)** | **(C) oracle pool (Noeracle) + keeper triggers + vault counterparty** | **✓ — this is the point** | own pull oracle + keeper + Soroban | **High (all state/settlement on-chain)** | Testnet |

Three structural conclusions from the landscape:
1. **Every CLOB — on-chain or off — solved cold start with a house pool or an affiliated MM** (HLP, MegaVault, LLP at 80 % of maker share, Amber for edgeX, OLP payments for Injective). Nobody bootstrapped a book with retail flow alone. A CLOB without that capital is a ghost book.
2. **Every surviving oracle pool retrofitted the same three controls:** price-impact/skew fees, per-asset OI caps, and a buffer layer between trader PnL and LP principal. The ones that skipped any of the three are the incident list in §4.
3. **Points→TGE→cliff is the dominant failure mode of 2025–26 growth** (Paradex −95 %, Aevo, MYX; Aster delisted from DefiLlama). Volume is the most corrupted metric in this sector; TVL and OI from independent adapters are the trustworthy signals — plan our own KPIs and any future incentive program accordingly.

---
### 2.27 Same-day metrics snapshot (DefiLlama, 2026-07-08)

One page-load snapshot of defillama.com/perps + per-protocol pages, accessed 2026-07-08. DefiLlama now publishes **Normalized** (wash-adjusted) vs **Reported** volume columns — itself evidence of how corrupted volume is as a sector metric. Where this table disagrees with the per-protocol figures in §2.1–2.25 (different aggregators, different sampling hour), both are kept and the discrepancy stands as reported.

**Sector totals:** perp DEX 24h volume **$18.266B** · open interest **$16.693B** · 30d volume **$589.3B** · DEX share of CEX futures volume **~14.5 %** (Jun 2026, The Block data page — approximate).

| # | Protocol | Chain | 24h vol (norm) | 7d vol | OI | TVL (house pool) | Taker/Maker |
|---|---|---|---|---|---|---|---|
| 1 | Hyperliquid | own L1 | $6.42B ($5.57B) | $43.2B | $10.27B | HLP $258.7M | 4.5/1.5 bps |
| 2 | Aster ⚠ | "Off Chain" | $1.63B ($1.80B) | $11.0B | $1.81B | $787M parent | UNVERIFIED |
| 3 | Lighter | own zk L2 | $1.36B ($1.39B) | $8.56B | $807M | bridge $509M | 0/0 |
| 4 | Grvt | GRVT chain | $1.35B ($1.13B) | $8.31B | $345M | bridge $40M | UNVERIFIED |
| 5 | ApeX Omni | zkLink | $1.06B | $7.33B | $112M | $34M | 5/2 bps |
| 6 | Variational | Arbitrum | $1.02B | $6.03B | $1.13B | UNVERIFIED | UNVERIFIED |
| 7 | StandX | own chain | $776M | $4.92B | $82M | bridge $39M | UNVERIFIED |
| 8 | GMTrade | Solana | $582M | $4.13B | $213M | $37M | UNVERIFIED |
| 9 | Evedex | Eventum | $509M | $3.65B | $95M | $1.9M | UNVERIFIED |
| 10 | Pacifica | Solana | $481M | $2.74B | $87M | $27M | 4/1.5 bps |
| 11 | edgeX | own L1 | $339M ($430M) | $3.21B | $402M | bridge $96M | 3.8/1.2 bps |
| 12 | Extended | Starknet | $253M ($589M) | $1.78B | $204M | $133M | 2.5/0 bps |
| 14 | Jupiter | Solana | $236M | $1.42B | $69M | JLP $706M | 6 bps open/close |
| ~23 | GMX v1+v2 | Arb/Avax+ | $79.9M | $917M | $55M | $176M | 4–6 bps open/close |
| ~24 | dYdX v4 | own chain | $73.9M | $560M | $42M | n/a | 5/1 bps |
| — | Gains | multi | $46.5M | $288M | UNVERIFIED | $12.8M | 3.5–6 bps o/c |
| — | Ostium | Arbitrum | $16.6M | $219M | $152.8M | $54.8M | ~4 bps open |
| — | Paradex | own appchain | $6.8M | $75.6M | $23.8M | bridge $22.5M | 0/0 retail |
| — | Synthetix | Ethereum | $2.4M | $19.4M | UNVERIFIED | $1.3M | UNVERIFIED |
| — | Aevo | own L2 | $133k | $10.5M | UNVERIFIED | $14.9M | 8/5 bps |
| — | Helix | Injective | $94k | $361k | UNVERIFIED | n/a | 5/−0.5 bps |
| — | Drift | Solana | $0 (halted) | $0 | — | $216M residual | — |
| — | MYX ⚠ | — | $0 (feed zeroed) | $0 | — | $140k | — |
| — | Vertex | — | sunset | — | — | ~$0 | — |
| — | Perp Protocol / Kwenta / Levana | — | dead/absorbed | — | — | <$0.5M | — |

Notes: ⚠ = volume authenticity disputed (Aster delisted by DefiLlama 2025-10, now "Off Chain" self-reported; MYX feed zeroed after wash allegations). Several bridge-TVL rows have no house pool. Jupiter's $236M here vs $530M in §2.6 (per-protocol page vs dashboard column, same day) illustrates the ±2× sampling noise in 24h figures; 30d figures are the more stable basis. Drift/Velocity halt corroborated by §2.15 primary sources. QFEX omitted (20× same-day self-report discrepancy).

---
## 3. Task 2 — Mechanism recommendation for Noether

### 3.1 The constraint set, restated with verified numbers

- **Soroban physics (live mainnet settings, queried 2026-07-08):** 5 s target ledger close (no 4 s vote yet; 2.5 s on the SDF roadmap, timing UNVERIFIED). Per-ledger Soroban budget: 580M CPU instructions (sequential path), 1,000 write entries, 2,000 txs, 266 kB tx-set. Parallel execution (2 dependent-tx clusters) is live but **useless for a CLOB — all book operations touch the same entries and collapse into one cluster**. At 2–5M instructions and ~4 writes per order operation, the hard ceiling is **~35–50 order ops/sec consuming 100 % of mainnet Soroban capacity (~10–25/s realistically shared), at ~5 s trade latency**. Batched settlement is much better: one 400M-instruction keeper tx can settle ~50–100 fills. Fees are a genuine strength: deterministic ~$0.004–0.005 per contract call, instant absolute finality, no reorgs, no mempool MEV.
- **State rent matters for books:** a resting order as a persistent entry prepays ≥120 days of rent; temporary entries are cheaper but vanish at TTL — either way, entry-per-order books are punished (200 write entries/tx). Aggregated per-level entries are mandatory if we ever build one.
- **Liquidity:** we launch with approximately zero. No committed MMs, no house-pool capital beyond what we seed.
- **Team:** small; every component we run off-chain (matcher, sequencer) is an ops liability and a trust deduction.

### 3.2 Ranking of mechanisms for a low-liquidity Soroban launch

**1. Oracle-priced pool with impact + caps (KEEP + HARDEN) — recommended.**
- *What breaks at low liquidity:* nothing mechanical — depth is synthetic and full from the first trade. What breaks instead is **risk**: with thin external markets and no impact fee, our book is a free option (GMX v1 AVAX math, §4.8); with a small vault, LP drawdown variance is proportionally violent (JLP −18 % day; gDAI 2022).
- *MM commitments required:* none. This is the decisive property.
- *Soroban support:* comfortable. One trade = one contract call; even 25 ops/s shared ≈ 90k trades/hour, orders of magnitude beyond launch volume. Our keeper/oracle stack (Noeracle pull oracle, publisher allowlist, deviation + staleness breaker, per-asset jump bounds, Binance divergence check) already implements most of the §4 mitigations.
- *Evidence:* every protocol that launched into zero liquidity and survived used this class (GMX 2021, Gains 2021, Jupiter 2023, Ostium 2025). Jupiter runs ~$700M of pool TVL on exactly this model today.

**2. Phased: oracle pool now → batch-auction book later — recommended roadmap (§3.5).**
- 5 s ledgers are a *natural* Frequent Batch Auction cadence (Injective's FBA proves per-block uniform-price clearing works and is MEV-resistant by construction). If Stellar ships 2.5 s ledgers and we have real flow, an on-chain FBA book is the decentralization-preserving upgrade path — matching stays in consensus, our narrative stays intact. Not for launch: an FBA book with no makers clears nothing.

**3. Hybrid CLOB (off-chain matching + Soroban settlement) — not now, possibly never.**
- *What breaks at low liquidity:* the book itself — ghost book, 50–200 bps spreads, zero size. Every comparable venue needed either an affiliated MM (edgeX/Amber), a protocol pool doing 80 % of maker share (Lighter LLP), or paid quoting (Injective OLP, Paradex XP quote-quality rewards). Realistic requirement: 2–3 committed MMs, ~$1–5M inventory each, maker rebates, and an SLA — none of which we have leverage to negotiate pre-volume.
- *Soroban support:* settlement side works (batch 50–100 fills/tx, ~5 s finality). But the matcher is a centralized Rust service **we** run: Vertex (company died → protocol died) and Lighter's Oct 2025 outage (single sequencer, LLP −5.35 %) are the reference failures. We would surrender "fully on-chain" for latency that is still 5 s to finality.
- *Verdict:* revisit only at Phase 3 volumes, and prefer FBA-on-chain over it if ledger times drop.

**4. Fully on-chain matched CLOB on Soroban — not viable as the primary mechanism.**
- 35–50 ops/s ceiling and ~5 s latency versus Hyperliquid's 0.1 s/200k; state rent punishes resting orders; and at our liquidity it would be a ghost book *anyway*. Hyperliquid is the proof that winning this way requires building your own chain — dYdX v4, with its own appchain and $20M of incentives, still holds <1 % of Hyperliquid's flow.

**5. vAMM — no.** The model is dead (Perp v1 CREAM insolvency; v2 impermanent-position adverse selection; protocol sunset 2025–26; Drift retired its vAMM to a backstop role). It solves cold start by hiding the counterparty, then the counterparty is us.

**6. Synthetic debt pool — no.** Its originator (Synthetix) abandoned it after the sUSD death spiral; it requires a large staked token base we don't have.

### 3.3 Is keeping "our fully on-chain CLOB" defensible?

Reframed: **we never had one.** `market/src/lib.rs` prices every open/close/trigger at `get_oracle_price`; there is no crossing of resting orders; the UI's "order book" renders pending trigger orders. What we have is an oracle-priced pool with on-chain limit/SL/TP/trailing trigger orders — i.e., roughly gTrade's execution model with Hyperliquid-style transparency of state. The defensible claim is **"every position, order, price and settlement is on-chain and verifiable"** — which is *stronger* than every off-chain-matched competitor (only Lighter's zk-matching and Injective/Hyperliquid's in-consensus matching compare) — not "we run an on-chain order book," which invites a comparison we lose on sight.

**Concrete recommendation:** formalize the oracle-pool mechanism as the product. Rename/refactor the UI (depth curve computed from our impact function + OI caps, not a fake book), keep on-chain trigger orders as the "order" surface, and invest the saved engineering into the §3.4 risk stack and the §6 backend. Decentralization-narrative cost: zero today (nothing moves off-chain); the cost only appears if we later choose an off-chain matcher — which is why the FBA path is the preferred Phase 3.

### 3.4 Counterparty model and the NOE vault (vs HLP / GLP / JLP)

Who takes the other side, by design:

| Design | Counterparty | LP drawdown risk | Notes |
|---|---|---|---|
| Matched CLOB (HL, dYdX) | other traders; house pool only as backstop-liquidator | Backstop inherits toxic positions (JELLY, POPCAT) | needs makers |
| Oracle pool (GMX/JLP/gTrade/**Noether**) | LP vault, always | Direct: LP is short trader alpha, long fees | needs risk stack, not makers |
| Netting-first (MYX MPM) | other traders first, vault for residual | reduced but nonzero | economically ≈ what skew funding does over time |
| Fully-funded (Levana) | LP, but max payout pre-locked | bounded per position, capital-hungry | died anyway (staleness) |
| RFQ dealer (Variational) | one professional hedging dealer | dealer solvency | not decentralizable |

The NOE vault is a GLP-family house pool: USDC in → NOE LP token; market pushes aggregate unrealized PnL into NAV; winners settle from the vault under a 70 % reserve cap with explicit `Shortfall` accounting; losses are capped at trader collateral. Against the incident record, its design risks and fixes:

1. **Zero-impact execution against it is a free option on thin pairs** (GMX v1 AVAX). *Fix:* price-impact/spread term scaling with |ΔOI| vs configured per-asset depth + **per-asset OI caps** (the deferred P5-1 RiskConfig). Caps must bind against *external oracle-moving cost*, not vault size alone: for a pair where $500k of CEX flow moves price 5 %, max net OI must keep `N × 5 % < manipulation cost + fees` (§4.8).
2. **LP is short trader alpha in trends** (JLP paid out $6.85M over 3 months; −18 % day). *Fix:* skew-scaled funding/borrow so one-sided books pay the vault continuously; publish expected-variance disclosures; keep total OI ≤ 30–50 % of vault NAV at launch.
3. **No buffer between trader PnL and LP principal.** Our 70 % reserve cap stops catastrophic drain but converts tail events into `Shortfall` for winners — bad UX and bad optics. *Fix:* Ostium-style **two-tier structure**: route a protocol fee share into an insurance buffer sub-account that absorbs trader net wins first; the vault becomes counterparty only when the buffer is exhausted. This is an accounting change, not a redesign.
4. **NAV manipulation via in-flight accounting** (GMX v1 2025 reentrancy: $42M). Soroban has no reentrancy in the EVM sense (no mid-call handoff to arbitrary code in our flows), but the *class* — LP price derived from mutable in-flight state — applies. *Fix (mostly done):* NAV updates only via keeper `push_unrealized_pnl` + `settle_pnl` with caps; keep deposit/withdraw NAV reads to settled state; never price NOE off unsettled aggregates.
5. **Winner-withdrawal drain** (HL 50x whale; Drift v1 PnL-banking). *Fix (partially done):* loss-capping and margin checks exist; add rate-limited realized-PnL withdrawal (e.g., per-account and global daily caps relative to buffer size) so a manipulation must survive multiple funding/oracle windows before it can exit.
6. **Keeper/price-setter compromise is game-over** (KiloEx $7.5M). *Fix (done, keep hard):* publisher allowlist on the router, keeper key hygiene, deviation + staleness breakers; add alerting on breaker trips (ties into §6 backend).

### 3.5 Phased migration path

- **Phase 0 — pre-mainnet hardening (4–8 weeks).** P5-1 per-asset OI caps + RiskConfig; price-impact/spread function; skew-scaled funding upgrade; insurance buffer sub-account; PnL-withdrawal rate limit; replace order-book UI with depth/impact display; expand contract tests for each control. *Decentralization cost: none.*
- **Phase 1 — mainnet launch.** 4–6 pairs (BTC, ETH, XLM, SOL, XRP; add BNB later; keep DOGE/ZEC/TRX/LINK/BCH/LTC testnet-only or behind caps sized to §4.8 math — HYPE stays hidden). Vault cap $250k–$1M with a public NAV methodology + drawdown disclosure; 63–75 % of fees streamed to NOE LPs (real-yield pattern that bootstrapped GLP/JLP/gDAI); leverage stays ≤10x (HL cut BTC to 40x/ETH to 25x *with* $10B books — 10x at our depth is already generous). *Decentralization cost: none.*
- **Phase 2 — traction ($1–10M/day).** RFQ/JIT lane for size (quote-on-request against whitelisted fillers, oracle-bounded — Drift's JIT and Variational's dealer model, minus the pool); points/incentives **only** on fees paid + OI held (Chaos-Labs-style wash detection; never reward raw volume — Aster/MYX are the cautionary tales); first external MM conversations from a position of real flow. *Decentralization cost: minimal (RFQ fillers are permissioned but settlement stays on-chain).*
- **Phase 3 — scale decision gate ($10M+/day sustained, or Stellar at 2.5 s ledgers).** Choose between (a) **on-chain FBA order book** — per-ledger uniform-price batch auctions, Injective-style, decentralization-preserving, feasible within ~580M instructions/ledger for aggregated-level books with batch matching; or (b) off-chain matcher + batch settlement — only if latency-sensitive MM flow demonstrably justifies surrendering the on-chain story. Explicit criteria: ≥3 MMs committed in writing, ≥$5M their aggregate inventory, DEX-wide latency parity impossible via (a).
- **Never:** vAMM; synthetic debt pool; points for raw volume.

---
## 4. Incident dossier — what kills protocols like ours

Full details and sources in §7; condensed here because every row shaped §3.4.

| Incident | Class | Root cause | Loss | Mitigation for Noether |
|---|---|---|---|---|
| GMX v1 AVAX (2022-09) | zero-slippage oracle exec | thin-market oracle push, no impact | ~$565k | OI caps + depth-aware impact fee |
| Mango (2022-10) | own-market oracle collateral | self-referential thin collateral + PnL borrow | ~$117M | never collateralize an asset at its own thin price; haircut unrealized PnL |
| Levana (2023-12) | pull-oracle staleness | congestion blocked Pyth updates 13 days | ~$1.15M | hard staleness bounds halt execution (we have this — keep strict) |
| HL 50x whale (2025-03) | margin-withdrawal loophole | withdraw uPnL → self-liquidate onto HLP | ~$4M HLP | block withdrawals that breach maintenance; rate-limit PnL exit |
| HL JELLY (2025-03) | backstop inherits toxic position | OI ≫ exitable liquidity on thin pair | >$10.5M float | OI caps sized to exitable liquidity; never need governance force-settle |
| KiloEx (2025-04) | keeper price-setter authz | forwarder didn't verify caller → fake setPrices | ~$7.5M | publisher allowlist + keeper key hygiene (done); alert on breaker trips |
| GMX v1 reentrancy (2025-07) | vault NAV accounting | re-entered position path corrupted AUM → LP mint/redeem at fake price | ~$42M | NAV from settled state only; CEI on all settlement paths |
| Lighter outage (2025-10) | liveness | single sequencer died at 79.8× load | LLP −5.35 % | (argues against us running an off-chain matcher) |
| HL POPCAT (2025-11) | spoof + cascade | fake wall → cascading liqs into HLP | ~$4.9M | impact-aware mark, liq buffers |
| Drift/Velocity (2026-04) | governance keys | social-engineered council + durable-nonce pre-signing → fake collateral listed | ~$285M | multisig hygiene, collateral listing timelocks, no blind signing |
| JLP/gDAI drawdowns (chronic) | LP variance | traders net-win in trends | −18 % day (JLP) | buffer tier, skew funding, fee floor > trader edge, disclosure |

**Attack-cost arithmetic (the sizing rule for every cap we set):** an attacker's profit from pushing our oracle ≈ `N × X% − C`, where `N` = max net position our contracts allow on the pair, `X%` = achievable price move on the venues feeding Noeracle, `C` = cost of moving those venues (slippage + fees + inventory risk). Zero-impact execution makes the trade repeatable (GMX saw 5 cycles in an hour). Our controls must force `N × X% < C` per pair: that is a *joint* constraint on OI caps, impact fees, funding drag, staleness windows, and which pairs we list at all. For majors (BTC/ETH/SOL/XRP/XLM) `C` is enormous and the constraint is easy; for ZEC/TRX-class pairs at launch size it binds hard — which is exactly why Phase 1 lists 4–6 pairs.

---

## 5. Task 3 — Feature gap analysis

### 5.1 Feature matrix (top venues vs Noether, 2026-07-08)

✓ = has, ◐ = partial, ✗ = lacks. Noether column reflects the current repo (testnet).

| Feature | Hyperliquid | dYdX v4 | GMX v2 | Jupiter | Gains | Ostium | Lighter | **Noether** |
|---|---|---|---|---|---|---|---|---|
| Cross margin | ✓ | ✓ | ✗ (isolated) | ✗ | ✗ | ✗ | ✓ | **✓** |
| Isolated margin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **✓** |
| Multi-collateral | ✓ | ✗ (USDC) | ✓ (pool assets) | ◐ | ✓ (gTokens) | ✗ (USDC) | ✗ | **✗ (USDC)** |
| Funding rate | ✓ 8h/1h | ✓ | ✓ OI-balancing | ✗ (borrow only) | ✗ (borrow+spread) | ✗ (rollover) | ✓ | **✓ hourly cumulative** |
| Partial liquidation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **✗ (full-close)** |
| Insurance fund | ✓ (HLP+AF) | ✓ | ◐ (pool) | ◐ (pool) | ◐ (buffer+GNS mint) | ✓ (buffer tier) | ✓ (LLP) | **◐ (70 % reserve cap only)** |
| ADL | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | **✗** |
| Max leverage | 40x BTC | 20x | 100x | 250x | 500x | 200x | 50x | **10x** |
| Limit orders | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **✓ (trigger)** |
| SL/TP | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **✓** |
| Trailing stop | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓ (rare!)** |
| Reduce-only | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | **✓** |
| Post-only / TWAP / scale | ✓ | ✓/◐ | ✗ | ✗ | ✗ | ✗ | ✓ | **✗ (n/a without book / ✗ / ✗)** |
| Sub-accounts | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | **✗** |
| Portfolio margin | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✗** |
| Copy trading / social vaults | ✓ (user vaults) | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ (public accts) | **◐ (vault leader-trade)** |
| Earn/LP vault | ✓ HLP | ✓ MegaVault | ✓ GM | ✓ JLP | ✓ gTokens | ✓ OLP | ✓ LLP | **✓ NOE vault** |
| Points/airdrop | done (HYPE) | done | ✗ | ✗ | ✗ | ✓ live S2 | done (LIT) | **✗** |
| Referrals | ✓ | ✓ | ✓ | ✓ | ✓ (5 % fees) | ✓ | ✓ | **✓ (bind mechanic)** |
| Mobile | ◐ web | ◐ | ◐ | ✓ | ◐ | ◐ | ✓ app | **◐ (responsive web, recently improved)** |
| Pro REST API + API keys | ✓ | ✓ | ◐ | ◐ | ◐ | ✓ | ✓ | **✓ (REST + keys)** |
| WebSocket feeds | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | **◐ (WS exists; needs channels, see §6)** |
| Charting | ✓ TV lib | ✓ TV lib | ✓ | ✓ | ✓ | ✓ | ✓ | **✓ native candles + own chart (licensing-safe)** |
| On/off-ramp | ◐ (Arbitrum bridge) | ◐ | ◐ | ✓ Solana | ◐ | ◐ | ◐ | **◐ faucet (testnet); Stellar anchors = mainnet opportunity** |
| Leaderboard | ✓ | ✓ | ✗ | ◐ | ✗ | ✓ | ✓ | **✓** |

### 5.2 Add (prioritized)

**Table stakes (blockers or near-blockers for mainnet credibility):**
1. **Insurance buffer tier** between trader PnL and vault principal (§3.4.3) — **M**. Every serious venue has one; our reserve-cap-only design is the weakest in the matrix row.
2. **Partial liquidations** — close only enough to restore maintenance margin instead of full-close — **M** (contract change; liquidation engine already factored).
3. **Per-asset OI caps + price impact** (§3.4.1) — **M**. Listed under features because traders see it as "max position size per market," which every venue shows.
4. **WebSocket market-data channels** (prices, positions, fills, funding — §6) — **M**, mostly backend.
5. **Funding/borrow surface in UI + API** (current rate, next rate, historical series) — **S** once the indexer stores it; traders will not size positions blind.

**Differentiators (lean into what the field lacks):**
6. **RWA/FX pairs via Noeracle** (EUR/USD, gold, index) — **L** but uniquely defensible on Stellar: the anchor network is FX-native, Ostium proved $170M+ OI demand, and *nobody* has RWA perps with on-chain settlement + near-zero fees. Sequence after Phase 1 stabilizes.
7. **Copy-trading productization of vault leader-trade** — we already have the primitive (leader trades vault capital); add follower vaults with per-leader fee share — **M**. Hyperliquid's user vaults validated demand.
8. **Points program designed from day one to reward fees + OI, never raw volume** — **S** engineering, mostly policy. Explicitly Chaos-Labs-style sybil/wash filtering (dYdX v4 precedent).
9. **TWAP + scale/ladder trigger orders** (keeper-sliced) — **M**; cheap to do with our keeper architecture and rare among oracle-pool venues.

**Defer:** multi-collateral (until XLM/anchor-asset collateral has a risk framework), sub-accounts/portfolio margin (pro-tier demand only), options (never at our size), post-only (meaningless without a book).

### 5.3 Improve

- **"Order book" view → depth/impact view** (§3.3): render the impact curve + OI caps + funding skew — honest and *more* informative than a fake book. The current N+1 chain-read implementation goes away with the indexer regardless. **S/M.**
- **NOE vault vs HLP/GLP/JLP standards:** publish NAV methodology + real-time composition; add deposit/withdraw epochs or cooldown (JLP-style) to prevent NAV-timing games around PnL pushes; buffer tier per §3.4; APY display must separate fee yield from trader-PnL variance (the "honest metrics" pass the UI already started). **M.**
- **Funding design:** current hourly base-rate + cumulative index is sound; upgrade the rate function to a skew-premium (Synthetix-v2-style premium/discount) so funding actively recruits the balancing side. **M.**
- **Leaderboard/referrals:** functional and recently reworked; extend leaderboard to weekly epochs + PnL% cohorts once pnl_ticks exist in the indexer. **S.**
- **Liquidation engine:** add keeper redundancy (≥2 independent keepers with staggered triggers) and public liquidation feeds; our single-keeper dependence is a liveness risk the Lighter outage illustrates. **M.**

### 5.4 Remove / deprioritize

- **The 14-pair listing at launch** — cut to 4–6 (§3.5). Thin pairs are pure attack surface (§4.8) and split whatever liquidity narrative we have. Relist gradually behind caps. **S (config).**
- **Fake order-book UI** — remove (replaced per §5.3). **S.**
- **Faucet** — testnet-only artifact; keep out of mainnet scope. **0.**
- **HYPE pair** — already hidden; drop from contracts config at mainnet cutover. **0.**
- Anything labeled "pro" (sub-accounts, portfolio margin, post-only) until Phase 2+.

### 5.5 Our positives, how they get attacked, and the defense

| Our claim | The attack | The defense |
|---|---|---|
| Near-zero fees (~$0.004 gas; 2/5 bps trading) | "Lighter/Paradex charge 0 bps" — zero *trading* fees are now table stakes at zk venues | Sell the *sum*: no gas per action + low fees + 63–75 % of fees to LPs as real yield + no points-dilution games. Zero-fee venues monetize via house pools and token mechanics anyway; our fee flow is the LP product. |
| Full on-chain verifiability (every order, price, settlement) | "So is Hyperliquid, and it's 50× faster" / "verifiability without liquidity is a museum" | Position precisely: HL is fast but runs a closed-source binary with Foundation-majority stake and has overridden markets (JELLY); the off-chain CLOB cohort can't show you matching at all; only Lighter's zk proofs compare — and it went dark for hours mid-cascade. We are the *simplest* trust story in the category: SCP finality, open contracts, ~$0.004 to verify anything yourself. Pair it with §3.4 risk transparency (published caps, buffer, breaker status) so the verifiability is *of something safe*. |
| First-mover on Stellar | "First mover on an empty chain" — the market can ignore us; or Stellars Finance-type competitor ships first on mainnet (their oracle-perp design targeted Feb 2026 mainnet, status UNVERIFIED) | Speed to mainnet with the hardened mechanism; lock in Stellar-ecosystem distribution (SCF/SDF channels, wallet integrations, anchor on-ramps — MoneyGram-class fiat rails no other perp DEX has); make XLM perps + FX pairs the Stellar-native wedge; ship the SDKs (already on npm/PyPI) as the developer moat. |

---
## 6. Task 4 — Backend & data architecture

### 6.1 How the leaders do it (verified against repos/docs, 2026-07-08)

**dYdX v4 indexer — the reference implementation** (github.com/dydxprotocol/v4-chain, `indexer/`, TypeScript monorepo):
- The full node itself is the producer: `protocol/indexer/msgsender` publishes to **Kafka** — topic `to-ender` carries one `IndexerTendermintBlock` per block (committed on-chain events, 10–50/s); topic `to-vulcan` carries order-lifecycle churn that never lands in blocks (~500–1,000/s).
- **ender** consumes `to-ender`, applies each block to **Postgres as a single set-based PL/pgSQL call** (`dydx_block_processor.sql`) — atomic, idempotent, replayable, block height as watermark — and emits websocket payloads *back onto Kafka*.
- **vulcan** consumes `to-vulcan` and maintains the live book in **Redis** (Lua scripts for atomic level updates: `orderbook-levels-cache`, `orders-cache`, `order-expiry-cache`, …).
- **comlink** = stateless REST (reads PG/Redis); **socks** = stateless WebSocket fan-out of the Kafka `to-websockets-*` topics (orderbooks, subaccounts, trades, markets, candles, block-height); **roundtable** = 25 cron tasks (create-pnl-ticks, update-funding-payments, create-leaderboard, market-updater, cache-orderbook-mid-prices, cancel-stale-orders, uncross-orderbook, track-lag, …); **bazooka** = Lambda migrations/topic setup.
- ~35 Postgres tables (fills, orders, perpetual_positions, funding_index_updates, funding_payments, oracle_prices, candles, pnl_ticks, transfers, trading_rewards, vaults…). Deployment: Terraform + ECS Fargate + RDS + ElastiCache + Kafka/MSK + Datadog (github.com/dydxprotocol/v4-infrastructure). Separately, MMs bypass the indexer entirely via full-node gRPC streaming (snapshot-then-delta with `snapshot: true`).

**Hyperliquid:** no indexer product at all — API servers *are* non-validator nodes replicating HyperCore state; `--serve-info` turns any node into a private API server; flat-file firehose (`--write-fills` etc., ~100 GB/day) + requester-pays S3 archives feed community indexers. Weight-based rate limits, including the notable **address quota: 1 request per 1 USDC of cumulative volume**. WS pushes full `l2Book` snapshots rather than sequenced deltas.

**Drift (pre-halt):** the book is a *derived view* — `dlob-server` reconstructs it from on-chain accounts via Solana RPC/Geyser gRPC; `dlob-publisher` → Redis → `ws-manager` fan-out (snapshots every ~400 ms, 5 s heartbeat, 50-msg backpressure disconnect); permissionless keeper bots do matching/liquidation; history = parsed tx logs → daily CSVs on S3 → later a cached Data API.

**Vertex:** Gateway API (the Rust sequencer itself, real-time) + a separate Archive/Indexer API for history — the two-plane split (live vs historical) in its clearest form. **Aevo:** risk-engine-gated off-chain book; WS book channel ships **checksummed** snapshots/updates; EIP-712-signed orders separate trading keys from custody keys.

**The 10 rules** distilled from all five (§7 sources): (1) separate ingestion from serving via a durable log; (2) split committed-event and ephemeral-event planes, size storage accordingly; (3) live/derived state in Redis, the ledger of record in Postgres; (4) process each block atomically + deterministically, block height as watermark; (5) fan out WS from the bus, never from ingestion services; (6) snapshot+delta with explicit resync semantics (or push snapshots and eat the bandwidth); (7) precompute aggregates in cron jobs, never at request time; (8) weight-based rate limits, optionally activity-coupled; (9) offer an escape hatch below the API (self-hostable read node); (10) bulk history out-of-band on S3; boring managed infra (TS/Node read path, Rust hot path, Terraform/ECS/RDS/ElastiCache).

### 6.2 What Stellar gives us (and takes away)

Working in our favor: **instant absolute finality** (no reorg handling, exactly-once ingestion, sequential cursors — rule 4 comes free); `getEvents`/`getTransactions` with clean cursoring; deterministic fees. Working against us: **RPC retention is ~7 days of ledgers / 24 h of events by default** — the indexer is not optional, it is the only place history exists; Horizon is deprecated for Soroban; full-history replay needs **Galexie/CDP** (core → `TxMeta` files → S3 data lake) or Hubble/BigQuery for analytics.

### 6.3 Target architecture for Noether (AWS, right-sized)

We are dYdX-shaped at 1/1000 the event rate (our whole chain does <10 Soroban events/s). Same shape, lighter parts — and half of it already exists in `indexer/` and `api/`.

```
                        ┌──────────────────────────── AWS ────────────────────────────┐
Stellar RPC ──getEvents/getTransactions──► [ingestor (ender-equiv)]                   │
  (managed or self-hosted, multi-RPC       │  per-ledger atomic txn → Postgres        │
   failover — exists today)                │  ledger_seq watermark                    │
Galexie ► S3 data lake (full history,      │  emits domain events → Redis Streams     │
  backfill/replay; add at mainnet)         ▼                                          │
                          [RDS Postgres]        [ElastiCache Redis]                   │
                          fills, positions,     live prices, depth curve,             │
                          orders, funding_*,    leaderboard ZSETs, ws pub/sub,        │
                          pnl_ticks, candles,   hot candle buffers                    │
                          vault_nav, referrals       ▲                                │
                               ▲                     │                                │
       [jobs (roundtable-equiv, ECS scheduled)] ─────┘                                │
       pnl ticks · funding history rollup · leaderboard · 24h stats ·                 │
       candle seed/backfill · reconciler (see below)                                  │
                               │                                                      │
        [api (comlink-equiv, Fastify — exists)]   [ws (socks-equiv — exists)]         │
        REST, API keys, weight rate limits        channels: prices, candles,          │
                               │                  positions, fills, funding, vault    │
                               └───────► CloudFront ◄─────────┘                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
Keeper (exists): Noeracle publish · trigger exec · liquidations · push_unrealized_pnl
Web (Vercel): reads ONLY the API/WS; chain access solely for wallet signing + simulation
```

**Components and deltas from today:**
1. **Ingestor** (evolve existing `indexer/`): keep the RPC poller with multi-RPC failover, dead-letter isolation and idempotency we already built; make ingestion **per-ledger atomic** (one DB transaction per ledger, `ledger_seq` recorded — the PL/pgSQL-style discipline without the PL/pgSQL); publish domain events to **Redis Streams** after commit. *Kafka/MSK is deliberately deferred:* dYdX needs it at 1,000 events/s; we adopt the topology (bus between ingestion and serving), not the hardware, and the Streams API maps 1:1 onto Kafka topics if we outgrow it. Move storage libsql → **RDS Postgres** (16, single AZ → multi-AZ at mainnet; Timescale extension for candles/pnl_ticks if retention grows).
2. **Jobs**: extend the existing candle aggregator into the roundtable pattern — `pnl_ticks` (per-account snapshots powering portfolio history + leaderboard), `funding_payments` rollups, 24 h market stats, stale-order cleanup, TTL-bump monitor for contract entries.
3. **API/WS** (evolve existing `api/`): add channels for prices (already SSE — port to WS channel), candles (exists), fills/positions per account, funding, vault NAV; snapshot-on-subscribe + incremental updates with a per-channel sequence number and documented resync ("re-subscribe on gap" is fine at our scale — Drift ships full snapshots every 400 ms and it works). Weight-based rate limits per API key (HL model, simplified).
4. **Edge**: CloudFront in front of REST + static; candle history cacheable (immutable per closed bucket).
5. **The UI stops reading the chain.** Every `get_all_order_ids`/`get_order` N+1, position poll, and vault read moves to the API. Wallet flows keep `simulateTransaction` (that is a signing concern, not a data concern).

**Verifiable consistency (off-chain vs on-chain):**
- **Watermark everywhere:** every REST/WS payload carries `at_ledger`; the UI can display "as of ledger N" and anyone can check the same state at stellar.expert.
- **Deterministic replay:** ingestion is a pure function of the event stream; from the S3 lake (Galexie) we can rebuild the DB from genesis and diff — the dYdX ender property, cheap at our volume.
- **Nightly reconciler job:** recompute open positions, aggregate OI, and vault NAV from `getLedgerEntries` (source of truth) and diff against Postgres; alert on any drift ≥1 stroop-equivalent; publish the last-reconciled ledger on a public status endpoint. This converts "trust our API" into "our API is checked against chain nightly, and you can rerun the check."
- **Event-hash chain (cheap extra):** store the RPC event `id` cursor chain per ledger so any third party can re-request the same ranges and byte-compare.
- Stellar's no-reorg finality makes all of this radically simpler than the EVM/Solana equivalents — no rollback paths at all.

**Sizing/cost note (indicative):** ECS Fargate 3 services × 0.5 vCPU, RDS db.t4g.medium multi-AZ, ElastiCache t4g.small, CloudFront — low hundreds of $/month at launch traffic; the S3 lake is dominated by ~GB/day of TxMeta. No component is exotic; the entire plane is replayable from chain + lake, so nothing in it is load-bearing for custody.

### 6.4 If we adopt a hybrid CLOB later (Phase 3 option b)

Only relevant if the §3.5 decision gate is passed. The design that preserves the most of our story:
- **Matcher:** single-writer deterministic Rust service (ECS/EC2, pinned AZ), consuming a **signed-order input log** (Kinesis or Kafka by then): orders are Stellar-account-signed payloads (same ed25519 keys as wallets — Pacifica's pattern), sequenced strictly by log arrival (FIFO); the matcher is replayable from the log, and a standby replays continuously (the Lighter outage lesson: liveness is the product).
- **Settlement:** every ledger (~5 s), the matcher submits one batch tx to the router — `settle_batch(fills[])`, ~50–100 fills within the 400M-instruction envelope; the batch carries a **Merkle root of the ordered input segment** it consumed, committed on-chain, so anyone holding the log segment can verify inclusion + ordering (fairness is *auditable*, not merely promised).
- **Escape hatch:** an on-chain `force_order` path (StarkEx forced-trade pattern): if a signed order demonstrably in the log is not settled within N ledgers, the user can execute it on-chain at oracle price against the pool — censorship costs the operator nothing but reputation *and* is mechanically bypassable.
- **Fallback:** matcher down → the protocol degrades to today's oracle-pool execution (Vertex's AMM-fallback pattern) — trading never halts because the book died.

---

## 7. Source list

Access dates as noted (2026-07-08 unless stated). Grouped by task. UNVERIFIED flags in body text override anything here.

**Mechanisms/protocols:** hyperliquid.gitbook.io (fees, rate limits, websocket, historical-data) · github.com/hyperliquid-dex/node · zealynx.io HyperBFT deep dive · docs.dydx.xyz (limit-orderbook, architecture/indexer, full-node-streaming, rewards) · dydx.foundation (trading/LP rewards history) · dydx.xyz/blog/v3-product-sunset · chaoslabs.xyz (launch incentives, wash detection) · docs.gmx.io (v2, fees) · gmxio.substack.com (Multichain, Chainlink Data Streams, STIP, GLP recovery) · support.jup.ag + docs.jup.ag (perps, oracles, fees) · x.com/JupiterExchange (Jun 2024, Sep 2025 fee changes) · docs.gains.trade (gToken vaults, fees/spread) · medium.com/gains-network (May 2022 recap, 2026 roadmap) · ostium-labs.gitbook.io + stork.network case study + theblock.co (Jump liquidity) · docs.levana.finance + blog.levana.finance postmortem · docs.aevo.xyz · docs.paradex.trade + paradex.foundation (DIME) + messari.io Paradex report · lighter.xyz + docs.lighter.xyz + onchaintimes.com (LLP) + panewslab.com (Oct 11 outage) · edgex docs (gitbook) + BlockEden perp-dex-wars-2026 · apex.exchange blog (Omni, zkLink, 2025 recap) · shoal.gg Drift deep dive + drift.trade v3 blog + driftprotocol.medium.com 2022-05-11 incident report · theblock.co/post/361570 (Vertex→Ink) · docs.injective.network + docs.helixapp.com · gate.com/learn (MYX MPM) + cryptonews/beincrypto (MYX scandal) · docs.asterdex.com + theblock.co/post/373458 (DefiLlama delisting) · docs.pacifica.fi · starknet.io blog (Extended, Paradex) · blog.synthetix.io (2026 roadmap, mainnet CLOB) + sips.synthetix.io (SIP-411/420/423) · support.perp.com + x.com/perpprotocol (sunset) · coindesk.com/business (Variational raise) · docs.pearprotocol.io (Symmio) · Avantis docs + Binance Academy (AVNT).

**Incidents:** cointelegraph.com + medium/@thedailychris (GMX AVAX 2022) · halborn.com + quillaudits.com + crypto.news (GMX Jul 2025) · chainalysis.com + cftc.gov + trmlabs.com (Mango + conviction vacated 2025-05) · theblock.co/post/348314 + coindesk (JELLY) · coindesk 2025-03-12 (50x whale) · thedefiant.io + ccn.com (POPCAT Nov 2025) · rekt.news/levana-rekt + Levana postmortem · coindesk + halborn (KiloEx Apr 2025) · theblock.co/post/348171 (Polymarket/UMA) · coindesk 2025-10-11 + thedefiant crash autopsy (Oct 10–11 cascade) · chainalysis.com/blog/lessons-from-the-drift-hack + elliptic.co + trmlabs.com + coindesk (Drift $285M, Apr 2026) + thedefiant.io (Velocity rebrand, Tether credit line) · onchaintimes.com + bidclub.io (HLP/JLP/gDAI return analyses).

**Stellar/Soroban (primary):** live mainnet `stellar network settings` via mainnet.sorobanrpc.com, CLI 27.0.0, 2026-07-08 (scp_timing 5000 ms; ledger limits incl. 580M instr, 1,000 writes, 2,000 txs; parallel clusters = 2; TTL params; fee rates) · github.com/stellar/stellar-protocol SLP-0004 (Final, 2026-01-12) + CAP-0063 + CAP-0078 · developers.stellar.org (resource limits & fees, state archival, RPC getEvents retention, Horizon→RPC migration, CDP/Galexie, Hubble) · stellar.org blog (Whisk P23, P24, Yardstick P26, Zipper P27, Road to 5000 TPS) · cheesecakelabs.com Soroban fee profiling · communityfund.stellar.org (Stellars Finance submission).

**Backends:** github.com/dydxprotocol/v4-chain (indexer services, kafka topics, postgres/redis packages, PL/pgSQL block processor) + github.com/dydxprotocol/v4-infrastructure (Terraform/AWS) · docs.dydx.xyz indexer + full-node streaming · Hyperliquid docs + node repo as above · github.com/drift-labs/dlob-server (archived 2026-06-23 → @velocity-exchange) + keeper-bots-v2 + drift-labs.github.io/v2-teacher · docs.vertexprotocol.com (gateway, archive indexer, architecture) · docs.aevo.xyz API reference.

**Metrics:** defillama.com/perps + per-protocol pages and api.llama.fi free endpoints (2026-07-08 snapshot: sector $18.27B/24h, OI $16.69B; normalized-vs-reported columns) · api.coingecko.com/api/v3/derivatives/exchanges (2026-07-08; BTC ≈ $62,250) · theblock.co/data DEX-to-CEX futures share (~14.5 %, Jun 2026) · coingecko.com/research State of Perpetuals 2026 ($7.9T 2025 perp DEX volume; DEX OI share 3.6 %→13.5 %) · official fee docs per protocol as cited inline.

**Known gaps (explicit):** exact current Hyperliquid OI (source conflict $3.5–10B); GMX v2 and Injective daily volumes (paywalled); Paradex/ApeX TVL; Pacifica current volume; Extended TGE status; Stellars Finance mainnet status; Gains "Jan 2023 incident" (could not verify — treated as non-event); several newer venues' fee schedules (edgeX/Ostium partial). None of these gaps affects the §1/§3 recommendation.
