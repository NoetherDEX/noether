# Staging Deploy Runbook (manual steps)

The code for Phase 0–1 + the Phase 2 oracle/keeper hardening + the adversarial
audit fixes is merged-ready on `feat/audit-phase0-1-security` (PR #31). Everything
below needs **your** credentials / dashboards / external keys, so it is done by
hand. Do these in order. **Never deploy to `main`** — staging only.

Contract WASM size is NOT a blocker: the live `maxContractSizeBytes` is 128 KB on
both testnet and mainnet; the market is ~73.7 KB.

---

## 0. Merge the PR
Merge `feat/audit-phase0-1-security` → `staging` (GitHub PR #31). Confirm CI is green.

---

## 1. Set the fail-closed secrets BEFORE the api/web deploy
The api and the web cron now **refuse to boot** on insecure defaults (P0-13/14), so
set these first or the deploy will crash-loop.

**Railway → `api` service** (Variables):
| Var | How to set |
|---|---|
| `API_HMAC_PEPPER` | `openssl rand -hex 32` |
| `API_CORS_ORIGIN` | `https://staging.noether.exchange` (not `*`) |
| `API_KEY_ALLOWLIST` | comma-separated Stellar `G...` addresses for the closed beta — or set `API_ALLOW_OPEN_ISSUANCE=true` to skip |

**Vercel → web project** (Environment Variables, Production+Preview):
| Var | How to set |
|---|---|
| `CRON_SECRET` | `openssl rand -hex 32` (same value in the cron caller) |

**Keeper service** (Railway or wherever it runs):
| Var | How to set |
|---|---|
| `KEEPER_SECRET_KEY` | a **dedicated** key, NOT the admin key (the keeper now hard-fails on mainnet if it falls back to the admin key) |
| `ALERT_WEBHOOK_URL` | optional Discord/Slack webhook for watchdog/error alerts |
| `ROUTER_PUBLISHERS` | the Noeracle publisher ed25519 pubkey(s) |

> Generate a dedicated keeper key: `stellar keys generate keeper --network testnet`
> then `stellar keys address keeper` (fund it via Friendbot).

---

## 2. Redeploy the contracts (testnet, blue-green)
Run from the repo root with the admin identity available.

```bash
# toolchain: contracts MUST build with 1.79.0 (1.94 breaks the wasm optimizer)
rustup toolchain install 1.79.0    # one-time, if missing

# the O-2 publisher allowlist — JSON array of 32-byte ed25519 pubkeys (hex).
# Empty [] = allow-all (the script warns); set the REAL Noeracle key(s) for prod.
export ROUTER_PUBLISHERS_JSON='["<noeracle_publisher_pubkey_hex>"]'

# blue-green: builds all wasms, deploys GREEN copies, initializes them
bash scripts/deploy_staging.sh
```

The script prints the new contract IDs. Then:
1. **Verify on-chain** (a few invokes against the GREEN ids): `is_paused`, a SL/TP
   set+fire, an open/close, the oracle deviation guard, an OI-cap reject.
2. **Update addresses**: write the new ids into `contracts.json` and the
   `NEXT_PUBLIC_*` env vars (api/web/keeper) so all services point at GREEN.
   This now includes **`NEXT_PUBLIC_NOETHER_ROUTER_ID`** for the keeper (P2-5: when
   set, the keeper liquidates/executes via the router's fresh-price methods).
3. If you initialized the router with an empty allowlist, set it now:
   `stellar contract invoke --id <ROUTER> ... -- set_publishers --publishers '["<hex>"]'`
4. **Set per-asset risk config (P5-1/P5-2, guarded launch).** For each live pair set
   the OI caps + leverage + maintenance margin via the new admin setter — this is
   how P6-6's "3 pairs @10x + OI caps" is enforced on-chain. Example (BTC):
   ```bash
   stellar contract invoke --id <MARKET> --source admin --network testnet -- \
     set_risk_config --asset BTC --rc '{"max_oi_long":"5000000000000","max_oi_short":"5000000000000","max_leverage":10,"maintenance_margin_bps":100,"max_position_size":"1000000000000"}'
   ```
   (i128 values are 7-dec strings; assets with no override stay UNCAPPED, so set
   every launch pair.) `maintenance_margin_bps` must be `< 10000 / max_leverage`.

---

## 3. Verify the service build branches (P0-1/P0-2)
- Railway `api` **and** `indexer` build from `staging` (addresses are baked at
  build time — a stale branch ships old ids).
- Vercel web builds from `staging`.
Trigger a redeploy of each after step 2 so they pick up the new addresses.

---

## 4. Restart the keeper
With the dedicated `KEEPER_SECRET_KEY` + new `NEXT_PUBLIC_*` addresses set, restart
the keeper. Confirm in logs: "Keeper key loaded", the keeper address, oracle pushes
succeeding, and the watchdog arming. Trip the alert webhook once to confirm it fires.

---

## 5. Smoke test (end to end)
From the staging web app (or a script): connect wallet → deposit USDC → open a
small position → set a stop-loss → close → confirm the indexer + `/v1/stats`
reflect it. That exercises web tx-assembly → router → market → vault → indexer → api.

---

## What is NOT required for this first testnet cutover
- **External gate:** Noeracle P2-1/2/3 (Yahya's hardened write path) — a **mainnet**
  prerequisite, not needed for testnet.
- **Later phases** (still code work, can land after the cutover): Phase 3 ops/
  monitoring, Phase 5 risk engine (MM raise, partial liq, insurance, ADL), Phase 6
  audit + guarded launch, remaining Phase 4 polish.
