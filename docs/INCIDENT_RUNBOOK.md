# Noether Incident Runbook

One page, for 3am. Audit refs: D-2, K-1, SEC-3, O-1. Keep this open in a pinned tab.

**On-call / escalation:** Yahya (contracts, oracle, keys) · Mert (web, api, infra).
Primary contact first; if no ack in 15 min, the other founder. **SEAL 911** (free 24/7
whitehat exploit hotline): https://www.seal911.org — Telegram `@seal_911_bot`. Use it
the moment funds are at risk and you need help you don't have.

---

## 0. Triage — what kind of incident?

| Symptom | Section |
|---|---|
| Prices frozen / diverging / obviously wrong | §1 Oracle stale |
| Keeper down (no liquidations, no funding) | §2 Keeper dead |
| Suspected exploit / vault draining / bad-debt spike | §3 Exploit → PAUSE |
| Admin key / faucet key possibly leaked | §4 Key compromise |
| RPC errors everywhere / indexer stalled | §5 RPC failover |

The single biggest lever is **§3 pause** — when in doubt and funds look at risk, pause first, diagnose second. Liquidations keep working while paused.

---

## 1. Oracle stale / wrong price

Marks frozen on the site, or a mark far off every CEX.

1. Check freshness: `curl -s $NOETHER_API_URL/v1/health | jq '.indexer, .contracts.market'` and the Noeracle SSE / shim slot age.
2. Is it the **keeper** (not pushing) or **Noeracle** (down)? If the keeper process is alive but prices are old → keeper push path (§2). If Noeracle's endpoint is down → the shim read still serves the last stored slot; the market's 60s staleness halts *opens* but **closes/liquidations stay allowed** (P1-5), so users aren't trapped.
3. Deviation breaker (#81) will already be rejecting absurd jumps on opens. If a *legitimate* fast move is being rejected, that's expected — it self-clears after the staleness window.
4. If a **bad price was written** and positions are being liquidated against it: **PAUSE (§3)** immediately, then rotate the Noeracle publisher / fix the feed before unpausing.

## 2. Keeper dead

No liquidations, funding not accruing, or the watchdog is restart-looping.

1. The keeper self-exits (`process.exit(1)`) if no cycle completes in 3 min → Railway restarts it. A restart **loop** means a hard error — check Railway logs for the alert reason.
2. Alerts fire to `DISCORD_WEBHOOK_URL` on startup / error-streak / shutdown. No alert + no cycle = the process is wedged on a hung request (should be impossible post-K-1 timeouts; if it happens, restart the Railway service manually).
3. Liquidations lagging during volatility: the keeper uses the router's `liquidate_with_price` / `execute_with_price` (P2-5), so a stale heartbeat no longer blocks liquidations. If they still fail, check the router publisher allowlist (P2-4) includes the keeper's pubkey.
4. Keeper wallet out of XLM freezes everything — check the balance alarm; refill the dedicated keeper account.

## 3. Suspected exploit → PAUSE

Vault USDC dropping fast, bad-debt / shortfall climbing, or an unexplained payout.

1. **PAUSE the market** (admin-signed; liquidations remain enabled):
   ```
   stellar contract invoke --id <MARKET> --source noether_admin --network <net> -- pause
   ```
   This blocks opens, closes, cross deposits/withdrawals and order placement. Confirm: an `open_position` now returns `#4 Paused`.
2. Pause the **vault** too if LP funds are the target: `... --id <VAULT> -- pause` (blocks deposit/withdraw; settlements still work so open positions can be wound down).
3. Snapshot state: `get_reserved_payout`, `get_shortfall`, `get_pool_info`, vault USDC balance. Note the attacker address + tx hashes.
4. Contact **SEAL 911**. Preserve logs. Do NOT unpause until root cause is understood and fixed — the market now has `upgrade(wasm_hash)` (P1-1) so a fix can ship without stranding positions.
5. Post-incident: if bad debt was socialized, the shortfall accumulator records the amount owed against the (Phase 5) insurance buffer.

## 4. Key compromise

Admin/issuer/faucet key possibly leaked (recall SEC-3: today one EOA is all of them).

1. Assume total compromise. **PAUSE market + vault** (§3) using the key while you still control it, or from a co-signer if multisig is live.
2. The admin key is USDC+NOE **issuer** — a leak means asset-issuance control. Rotate immediately: move admin/issuer to a fresh key (or the planned 2-of-3 multisig, P3-8) via `set_admin` on every contract + classic `SetOptions`.
3. Pull `ADMIN_SECRET_KEY` out of Vercel (the faucet path) — swap in the dedicated low-privilege faucet key. Redeploy web.
4. Rotate the keeper key if it shared any material.

## 5. RPC failover / indexer stalled

1. Keeper + indexer rotate through `SOROBAN_RPC_URLS` (comma-separated) on transient failure. If all endpoints are down, both back off + alert.
2. Indexer cursor stuck: check `/v1/health .indexer.ledgerAgeSeconds`. A gap past RPC retention is recorded in `ledger_gaps`; run `npm run reindex` after restoring a good RPC to replay from `events_raw`.
3. Point `SOROBAN_RPC_URLS` at a paid provider (see `docs/RPC.md`) — the public endpoint is rate-limited and unsuitable for keeper+indexer in parallel.

---

## Quick reference

```
Pause market:    stellar contract invoke --id <MARKET> --source noether_admin -- pause
Unpause:         ... -- unpause
Pause vault:     stellar contract invoke --id <VAULT>  --source noether_admin -- pause
Health + drift:  ./scripts/verify_stack.sh $NOETHER_API_URL
Resolved addrs:  curl -s $NOETHER_API_URL/v1/health | jq .contracts
```
