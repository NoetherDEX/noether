# Pair expansion 2026-09: PUMP + UNI (live), PAXG + XAUT (staged gold)

Noeracle (api.noeracle.org) serves 19 signed feeds since 2026-08-31; the four
new ones are verified live (5/5/4/4 exchange sources): PUMP ~$0.0043,
UNI ~$5.66, PAXG ~$4,343, XAUT ~$4,334. PAXG and XAUT price the TOKENS
(Paxos / Tether), not LBMA spot — the PAXG/XAUT basis is under review until
~2026-09-08; gold stays closed until Yahya signs off.

## What is already in the repo (staging branch)

| Layer | Change | State |
|---|---|---|
| `noether_common::assets::PAIR_TAGS` | +PUMP +UNI +PAXG +XAUT | committed |
| Router compiled `BANDS` | PUMP $0.000001–$1 · UNI $0.10–$10k · gold $100–$100k | committed |
| Keeper `DEFAULT_ASSETS` | all four publish (gold publishes for basis measurement; trading stays closed on-chain) | committed |
| Keeper `STORK_DEFAULT_ID_SYMBOLS` | +26 PAXG +27 PUMP +33 UNI +407 XAUT (17 total, verified live: all < 0.11% vs Noeracle, PAXG↔PAXG and XAUT↔XAUT token-to-token) | committed |
| `@noether/shared` SUPPORTED_ASSETS | +PUMP +UNI; gold rows staged (commented) | committed |
| Web ASSETS / Binance map / display | +PUMP +UNI; sub-cent 6dp tier for PUMP (formatter + chart priceFormat); Binance has PUMPUSDT, UNIUSDT, PAXGUSDT, XAUTUSDT | committed |

Nothing below has been executed on-chain. The contracts are upgrade-in-place
(`upgrade(new_wasm_hash)` on market, shim, router) — addresses never change,
so contracts.json, env vars, Vercel and Azure config all stay as they are.

## Ceremony A — open PUMP and UNI (staging stack first, then prod)

Addresses (canonical: contracts.json / contracts.staging.json):

| | prod | staging |
|---|---|---|
| market | `CBHHWFAYLB3SXJCE232DC6WNSK74IBEOROAGCI2AFBA2H5NQOH2KYKNN` | `CAWBRPRYOXMQNCDTJYQYVK6XYGKYSKXEFACIFHWYC5KJY5SDLSQMXBCF` |
| shim | `CDRQJDCZ2EKIVAM6D6U2YFTE7VNMN3TFUUJGZ5SKAFB5TCLMSHSSWU6N` | `CBHMBP2PRXZBKVMVUYAANKCTQSGBI45X2KUKWABFTCZE4C5VCS2V7T4G` |
| router | `CBDVQKYEN6QMRGQZC77DFYEQXQHDMCVJ3TPBJKNERJVMIESA6GQT44LG` | `CBTJLQVVMD54YO7HZA5K4P6SEGKXZHRNDNKDOPVOKAW6VNRIQ3MYZBGX` |

```bash
# 1. Build optimized WASM (from repo root, on the release commit)
./scripts/build_contracts.sh

# 2. Upload the three changed contracts, record each hash
stellar contract upload --wasm contracts/target/wasm/market.wasm        --source noether_admin --network testnet
stellar contract upload --wasm contracts/target/wasm/noeracle_shim.wasm --source noether_admin --network testnet
stellar contract upload --wasm contracts/target/wasm/noether_router.wasm --source noether_admin --network testnet

# 3. In-place upgrades (per stack; use that stack's admin identity)
stellar contract invoke --id <MARKET> --source noether_admin --network testnet -- upgrade --new_wasm_hash <MARKET_HASH>
stellar contract invoke --id <SHIM>   --source noether_admin --network testnet -- upgrade --new_wasm_hash <SHIM_HASH>
stellar contract invoke --id <ROUTER> --source noether_admin --network testnet -- upgrade --new_wasm_hash <ROUTER_HASH>

# 4. Risk config — the step that actually opens trading.
#    UNI mirrors the live alt ladder (verified on-chain vs DOGE 2026-09-01):
cat > /tmp/risk_uni.json <<'JSON'
{"max_leverage":10,"im_bps":400,"mm_bps":200,"close_out_bps":133,
 "max_position_size":"1000000000000","max_funding_velocity_bps":120,
 "funding_clamp_bps":5,"skew_scale":"2000000000000"}
JSON
#    PUMP is a sub-cent meme asset: 5x, $25k cap, $50k skew scale:
cat > /tmp/risk_pump.json <<'JSON'
{"max_leverage":5,"im_bps":2000,"mm_bps":1000,"close_out_bps":666,
 "max_position_size":"250000000000","max_funding_velocity_bps":120,
 "funding_clamp_bps":5,"skew_scale":"500000000000"}
JSON
stellar contract invoke --id <MARKET> --source noether_admin --network testnet -- set_asset_risk --asset UNI  --params-file-path /tmp/risk_uni.json
stellar contract invoke --id <MARKET> --source noether_admin --network testnet -- set_asset_risk --asset PUMP --params-file-path /tmp/risk_pump.json

# 5. Keeper images (nothing on Azure auto-deploys). Confirm the app↔stack
#    mapping first: az containerapp show -n <app> -g noether-rg --query properties.template.containers[0].image
az acr build -r noetheracr2026 -t noether-keeper-t3:vNEXT scripts/keeper
az containerapp update -n noether-keeper-staging -g noether-rg --image noetheracr2026.azurecr.io/noether-keeper-t3:vNEXT
# prod keeper app: noether-keeper (repeat with its image repo)

# 6. Gateway + webs (PUMP/UNI appear in /v1/markets and the UI)
az acr build -r noetheracr2026 -t noether-api:v19 -f api/Dockerfile .
az containerapp update -n noether-api -g noether-rg --image noetheracr2026.azurecr.io/noether-api:v19
DEPLOY_YES=1 ./scripts/deploy_web_azure.sh staging pairs   # then testnet + prod from their branches

# 7. Verify per stack
stellar contract invoke --id <SHIM> --source noether_admin --network testnet -- lastprice --asset PUMP
stellar contract invoke --id <SHIM> --source noether_admin --network testnet -- lastprice --asset UNI
# open → close a tiny PUMP and UNI position through the UI (router path),
# confirm funding seeds on the next apply_funding tick, and that
# GET /v1/markets lists 16 assets.
```

Notes for step 4: `mm_bps == im_bps / 2` is enforced on-chain (integer
division), `funding_clamp_bps 5` and `velocity 120` are the post-incident
values read live from the prod market on 2026-09-01. The vault's per-asset
caps fall back to safe defaults (25% side, 15% skew, 70% reserve) — no vault
call is required for new pairs.

## Ceremony B — open gold (~2026-09-08, after the basis review)

The contracts and keeper already carry PAXG/XAUT (tags, bands, price
publishing). Opening is config only:

```bash
#    3x, $25k cap, $50k skew scale — gold token books are thinner than majors
cat > /tmp/risk_gold.json <<'JSON'
{"max_leverage":3,"im_bps":3333,"mm_bps":1666,"close_out_bps":1111,
 "max_position_size":"250000000000","max_funding_velocity_bps":120,
 "funding_clamp_bps":5,"skew_scale":"500000000000"}
JSON
stellar contract invoke --id <MARKET> --source noether_admin --network testnet -- set_asset_risk --asset PAXG --params-file-path /tmp/risk_gold.json
stellar contract invoke --id <MARKET> --source noether_admin --network testnet -- set_asset_risk --asset XAUT --params-file-path /tmp/risk_gold.json
# optional, tighter than the 15% default while the pairs soak:
stellar contract invoke --id <VAULT> --source noether_admin --network testnet -- set_skew_cap --asset PAXG --bps 500
stellar contract invoke --id <VAULT> --source noether_admin --network testnet -- set_skew_cap --asset XAUT --bps 500
```

Then uncomment the PAXG/XAUT rows in `packages/shared/src/assets.ts` and
`web/lib/utils/constants.ts` (marked STAGED), rebuild gateway + webs.
Binance carries PAXGUSDT and XAUTUSDT, so both chart normally.

## Ceremony C — optional: arm Stork on the router (fixes `stork:check`)

`npm run stork:check` fails at the `relay_stork` simulation with
`Error(Contract, #1)` because T3 Part B (set_stork_config + set_stork_assets)
was never executed on the router. WS capture and parsing are healthy. If
arming, use the full 17-entry map (ids ascending, tags = ASCII `<SYM>USD`
zero-padded, byte-identical to PAIR_TAGS):

```
ids:  [3,4,6,11,12,14,19,21,22,26,27,32,33,38,39,40,407]
tags: ["4254435553440000","4554485553440000","4144415553440000",
       "4243485553440000","424e425553440000","444f474555534400",
       "4859504555534400","4c494e4b55534400","4c54435553440000",
       "5041584755534400","50554d5055534400","5452585553440000",
       "554e495553440000","5852505553440000","5a45435553440000",
       "534f4c5553440000","5841555455534400"]
```

```bash
cat > /tmp/stork_cfg.json <<'JSON'
{"enabled":true,"require_fresh":false,"signer":"<STORK_SIGNER_EVM>",
 "taxonomy":1,"max_age_secs":60,"max_dev_bps":100}
JSON
printf '%s' '["4254435553440000","4554485553440000","4144415553440000","4243485553440000","424e425553440000","444f474555534400","4859504555534400","4c494e4b55534400","4c54435553440000","5041584755534400","50554d5055534400","5452585553440000","554e495553440000","5852505553440000","5a45435553440000","534f4c5553440000","5841555455534400"]' > /tmp/stork_tags.json
stellar contract invoke --id <ROUTER> --source noether_admin --network testnet -- set_stork_config --config-file-path /tmp/stork_cfg.json
stellar contract invoke --id <ROUTER> --source noether_admin --network testnet -- set_stork_assets --ids '[3,4,6,11,12,14,19,21,22,26,27,32,33,38,39,40,407]' --tags-file-path /tmp/stork_tags.json
```

XLM has no Stork feed (unchanged) and must never be Stork-strict. Gold
cross-validates token-to-token only: Noeracle PAXGUSD vs Stork id 26
PAXGUSD — never against spot XAUUSD.

## Known issues logged during this work

- `cargo test -p market`: `winning_close_writes_vault_buffer_key_on_zero_draw`
  fails on clean HEAD too (pre-existing on staging, unrelated to the pair
  additions; 191 other tests pass).
- `scripts/keeper/.env` overrides contracts.json with an older contract
  generation — `stork:check`/`noeracle:check` ran against the .env-resolved
  addresses (router `CDTMJGS…`, Noeracle `CAXD5NUP…`), not the prod stack.
  Harmless for checks, but ceremony commands must use the addresses in the
  table above, and the Azure keepers already carry correct env overrides.
