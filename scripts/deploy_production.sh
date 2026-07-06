#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Noether PRODUCTION cutover deploy — Noeracle-only stack (Strategy 2: fresh stack)
# ═══════════════════════════════════════════════════════════════════════════════
# Stands up a COMPLETE fresh production stack with the real …LOLN admin, mirroring
# (and completing) the staging deploy. Per docs/NOERACLE_INTEGRATION_HANDOFF.md §4.
#
#   Fresh:   vault · market(→ shim) · router · vault_factory(→ market) · referral(→ market)
#   Reused:  NOE  (CD7VRBXI… — the EXISTING live NOE, code NOE:…LOLN) [user choice C]
#            noeracle_shim (CDHIGZ…) · Noeracle (CAYIP67…) · USDC (CA63EPM4…)
#
# WHY vault_factory + referral are redeployed: both pin the market address at
# initialize() and have NO setter, so a fresh market requires fresh copies bound
# to it (the leader-trade proxy and record_trade hook both read get_market()).
#
# Writes a SEPARATE contracts.production.json — does NOT clobber contracts.json
# (the authoritative live-address file) until the deliberate flip (Claude, git-side).
#
# Resumable: PROD_* ids persist to .env.production (git-ignored); a re-run skips
# already-deployed contracts and continues where a failure left off.
#
# Prereqs:
#   1. .env has ADMIN_SECRET_KEY = the real …LOLN prod admin (NOE + USDC issuer).
#   2. ./scripts/build_contracts.sh   (or this script builds if WASM is missing).
#
# Usage: ./scripts/deploy_production.sh
#
# Does NOT do (separate, deliberate steps — see end-of-run notes):
#   - Vault USDC liquidity seeding
#   - Railway keeper switch
#   - Vercel Production env flip / contracts.json promotion
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NEON='\033[38;5;198m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$PROJECT_ROOT/contracts"
WASM_DIR="$CONTRACTS_DIR/target/wasm"
ENV_FILE="$PROJECT_ROOT/.env"
STATE_FILE="$PROJECT_ROOT/.env.production"   # git-ignored; resumable PROD_* markers
PROD_JSON="$PROJECT_ROOT/contracts.production.json"

# Reused testnet addresses — defaults; overridable via .env.
DEFAULT_SHIM="CDHIGZLUPKSY747I3TLSKB4F6AQXQV4T54AKSQNFAEILUB6ROVAVUJHN"
DEFAULT_NOERACLE="CAYIP67UDVX5UPXGN3XDAWVIEFBAVG6G7LUESEOU3NUQKTWN55W34YBG"
DEFAULT_USDC="CA63EPM4EEXUVUANF6FQUJEJ37RWRYIXCARWFXYUMPP7RLZWFNLTVNR4"
DEFAULT_NOE="CD7VRBXIDYP2C2F2AZZL242GY4PRDVDH2BG3LAN2ASXYUXCPHWQJTDP5"   # reuse live NOE (choice C)

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}     Noether PRODUCTION cutover — full Noeracle-only stack (…LOLN admin)         ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# ── Load .env (admin + any overrides) + resumable state ───────────────────────
[ -f "$ENV_FILE" ] || { echo -e "${RED}Error: .env not found at $ENV_FILE${NC}"; exit 1; }
set -a; source "$ENV_FILE"; set +a
[ -f "$STATE_FILE" ] && { set -a; source "$STATE_FILE"; set +a; }

# ── Validate admin key ────────────────────────────────────────────────────────
if [ -z "${ADMIN_SECRET_KEY:-}" ] || [[ "${ADMIN_SECRET_KEY}" == *YOUR_SECRET* ]]; then
  echo -e "${RED}Error: ADMIN_SECRET_KEY (the …LOLN prod admin) not set in .env${NC}"; exit 1
fi

# ── Reused addresses (env override or default) ────────────────────────────────
SHIM="${NEXT_PUBLIC_NOERACLE_SHIM_ID:-$DEFAULT_SHIM}"
NOERACLE="${NEXT_PUBLIC_NOERACLE_ID:-$DEFAULT_NOERACLE}"
USDC="${NEXT_PUBLIC_USDC_TOKEN_ID:-$DEFAULT_USDC}"
NOE="${NEXT_PUBLIC_NOE_TOKEN_ID:-$DEFAULT_NOE}"

CLI="$(command -v stellar || command -v soroban)"
ADMIN="noether_admin"
# v26: `--secret-key` is a BOOLEAN flag; the secret is read from SOROBAN_SECRET_KEY
# (NOT positional). `|| true` makes re-runs idempotent (identity already exists);
# `keys address` below fails loudly under set -e if the import didn't take.
SOROBAN_SECRET_KEY="$ADMIN_SECRET_KEY" $CLI keys add "$ADMIN" --secret-key >/dev/null 2>&1 || true
ADMIN_PK="$($CLI keys address "$ADMIN")"

echo -e "${YELLOW}Configuration:${NC}"
echo "  Prod admin  : $ADMIN_PK   (NOE + USDC issuer)"
echo "  Shim (reuse): $SHIM"
echo "  Noeracle    : $NOERACLE"
echo "  USDC (reuse): $USDC"
echo "  NOE  (reuse): $NOE   ← existing live NOE (choice C)"
echo ""
echo -e "${YELLOW}⚠  Deploys a FULL FRESH PRODUCTION stack (vault, market, router, vault_factory,${NC}"
echo -e "${YELLOW}   referral) with the live …LOLN admin. Writes contracts.production.json only;${NC}"
echo -e "${YELLOW}   contracts.json stays untouched.${NC}"
read -r -p "Proceed? [y/N] " ok; [ "$ok" = "y" ] || { echo "Aborted."; exit 1; }
echo ""

# ── Admin funded on testnet? ──────────────────────────────────────────────────
if ! curl -s "https://horizon-testnet.stellar.org/accounts/$ADMIN_PK" | grep -q '"account_id"'; then
  echo -e "${RED}Error: admin $ADMIN_PK is not funded on testnet.${NC}"; exit 1
fi

# ── Resumable persist helper (writes to .env.production, NOT .env) ─────────────
save_var() {  # save_var KEY VALUE
  local k="$1" v="$2"; touch "$STATE_FILE"
  if grep -q "^$k=" "$STATE_FILE" 2>/dev/null; then
    local tmp; tmp="$(mktemp)"; sed "s|^$k=.*|$k=$v|" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
  else printf '%s=%s\n' "$k" "$v" >> "$STATE_FILE"; fi
}

# ── Build (only if any WASM missing) ──────────────────────────────────────────
need_build=0
for w in market.wasm vault.wasm noether_router.wasm vault_factory.wasm referral.wasm; do
  [ -f "$WASM_DIR/$w" ] || need_build=1
done
if [ "$need_build" = "1" ]; then
  echo -e "${YELLOW}Building contracts...${NC}"; "$SCRIPT_DIR/build_contracts.sh"
fi

# ═══ 1. Deploy contracts (ids first; init after) ══════════════════════════════
deploy_wasm() {  # deploy_wasm VARNAME wasm_name
  local var="$1" wasm="$2"
  if [ -z "${!var:-}" ]; then
    local id; id="$($CLI contract deploy --wasm "$WASM_DIR/$wasm" --source "$ADMIN" --network testnet)"
    save_var "$var" "$id"; printf '%s' "$id"
  else printf '%s' "${!var}"; fi
}
echo -e "${YELLOW}[1/4] Deploying vault, market, router, vault_factory, referral...${NC}"
PROD_VAULT_ID="$(deploy_wasm PROD_VAULT_ID vault.wasm)";                       echo "  vault        : $PROD_VAULT_ID"
PROD_MARKET_ID="$(deploy_wasm PROD_MARKET_ID market.wasm)";                     echo "  market       : $PROD_MARKET_ID"
PROD_ROUTER_ID="$(deploy_wasm PROD_ROUTER_ID noether_router.wasm)";             echo "  router       : $PROD_ROUTER_ID"
PROD_VAULT_FACTORY_ID="$(deploy_wasm PROD_VAULT_FACTORY_ID vault_factory.wasm)"; echo "  vault_factory: $PROD_VAULT_FACTORY_ID"
PROD_REFERRAL_ID="$(deploy_wasm PROD_REFERRAL_ID referral.wasm)";               echo "  referral     : $PROD_REFERRAL_ID"
echo ""

# ═══ 2. Initialize: vault → market(→shim) → router → vault_factory → referral ═
echo -e "${YELLOW}[2/4] Initializing (vault → market → router → vault_factory → referral)...${NC}"
# Honest init: success = OK; "AlreadyInitialized" (#1) = OK (idempotent re-run);
# ANY other error = fatal (no masking).
init_contract() {  # init_contract LABEL -- <invoke args...>
  local label="$1"; shift; local out
  if out="$("$CLI" contract invoke "$@" 2>&1)"; then echo "  ✓ $label initialized"
  elif echo "$out" | grep -q "Error(Contract, #1)"; then echo "  • $label already initialized"
  else echo -e "${RED}  ✗ $label init FAILED:${NC}"; echo "$out" | tail -4; exit 1; fi
}

# Vault: initialize(admin, usdc_token, noe_token, market_contract, dep_fee, wd_fee)
init_contract "vault" --id "$PROD_VAULT_ID" --source "$ADMIN" --network testnet -- initialize \
  --admin "$ADMIN_PK" --usdc_token "$USDC" --noe_token "$NOE" \
  --market_contract "$PROD_MARKET_ID" --deposit_fee_bps 30 --withdraw_fee_bps 30

# Market: oracle_adapter slot = the SHIM (exposes lastprice(Symbol)). CLI v26 wants
# the MarketConfig from a file with i128 fields as STRINGS (inline i128 is rejected).
MKTCFG="$(mktemp)"
cat > "$MKTCFG" <<'JSON'
{"min_collateral":"100000000","max_leverage":10,"maintenance_margin_bps":100,"liquidation_fee_bps":500,"trading_fee_bps":10,"base_funding_rate_bps":1,"max_position_size":"1000000000000","max_price_staleness":60,"max_oracle_deviation_bps":100,"base_maker_fee_bps":2,"base_taker_fee_bps":5}
JSON
init_contract "market (oracle → shim)" --id "$PROD_MARKET_ID" --source "$ADMIN" --network testnet -- initialize \
  --admin "$ADMIN_PK" --oracle_adapter "$SHIM" --vault "$PROD_VAULT_ID" \
  --usdc_token "$USDC" --config-file-path "$MKTCFG"
rm -f "$MKTCFG"

# Router: initialize(admin, market, noeracle, publishers) — the publisher
# allowlist (O-2/P2-4) is REQUIRED and must be non-empty; default is the live
# Noeracle attestation-service Ed25519 key (confirmed via api.noeracle.org).
ROUTER_PUBLISHERS_JSON="${ROUTER_PUBLISHERS_JSON:-[\"8f8650ca5cb1bc7491b68e02f4d89e54da1f1996e161897b0eabadc28534e17a\"]}"
init_contract "router" --id "$PROD_ROUTER_ID" --source "$ADMIN" --network testnet -- initialize \
  --admin "$ADMIN_PK" --market "$PROD_MARKET_ID" --noeracle "$NOERACLE" \
  --publishers "$ROUTER_PUBLISHERS_JSON"

# Vault factory: initialize(admin, market, usdc) — leader-trade proxies call THIS market.
init_contract "vault_factory" --id "$PROD_VAULT_FACTORY_ID" --source "$ADMIN" --network testnet -- initialize \
  --admin "$ADMIN_PK" --market "$PROD_MARKET_ID" --usdc "$USDC"

# Referral: initialize(admin, market) — record_trade is gated to THIS market.
init_contract "referral" --id "$PROD_REFERRAL_ID" --source "$ADMIN" --network testnet -- initialize \
  --admin "$ADMIN_PK" --market "$PROD_MARKET_ID"
echo ""

# ═══ 3. Pre-mint NOE to the new vault (reuses live NOE SAC; issuer = …LOLN) ════
# CHOICE C: mints 1e16 MORE of the EXISTING NOE on top of the ~3M already
# outstanding from the old vault — intended; pool supply stats will read inflated.
if [ -z "${PROD_NOE_PREMINTED:-}" ]; then
  echo -e "${YELLOW}[3/4] Minting 1,000,000,000 NOE to the new vault...${NC}"
  $CLI contract invoke --id "$NOE" --source "$ADMIN" --network testnet -- \
    mint --to "$PROD_VAULT_ID" --amount 10000000000000000
  save_var PROD_NOE_PREMINTED yes
  echo -e "${GREEN}✓ Minted 1,000,000,000 NOE to the vault${NC}"
else echo -e "${GREEN}[3/4] NOE already minted (skipped)${NC}"; fi
echo ""

# ═══ 4. Write contracts.production.json (separate from live contracts.json) ════
echo -e "${YELLOW}[4/4] Writing contracts.production.json...${NC}"
TS="$(date '+%Y-%m-%d %H:%M:%S')"
cat > "$PROD_JSON" <<EOF
{
  "network": "testnet",
  "env": "production",
  "deployedAt": "$TS",
  "contracts": {
    "market": "$PROD_MARKET_ID",
    "vault": "$PROD_VAULT_ID",
    "noeToken": "$NOE",
    "noetherRouter": "$PROD_ROUTER_ID",
    "vaultFactory": "$PROD_VAULT_FACTORY_ID",
    "referral": "$PROD_REFERRAL_ID",
    "noeracleShim": "$SHIM",
    "noeracle": "$NOERACLE",
    "usdcToken": "$USDC"
  },
  "admin": "$ADMIN_PK",
  "noeAsset": { "code": "NOE", "issuer": "$ADMIN_PK" }
}
EOF
echo -e "${GREEN}✓ Wrote $PROD_JSON${NC}"; echo ""

# ═══ Summary + remaining cutover steps ════════════════════════════════════════
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}        FULL PRODUCTION stack deployed → contracts.production.json               ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  market        → ${CYAN}$PROD_MARKET_ID${NC}  (oracle = shim)"
echo -e "  vault         → ${CYAN}$PROD_VAULT_ID${NC}"
echo -e "  router        → ${CYAN}$PROD_ROUTER_ID${NC}"
echo -e "  vault_factory → ${CYAN}$PROD_VAULT_FACTORY_ID${NC}"
echo -e "  referral      → ${CYAN}$PROD_REFERRAL_ID${NC}"
echo -e "  NOE           → ${CYAN}$NOE${NC}  (reused live)"
echo ""
echo -e "${NEON}Remaining (deliberate) steps — docs/NOERACLE_INTEGRATION_HANDOFF.md §4:${NC}"
echo -e "  1. Seed the new vault with USDC (faucet/mint → approve → vault.deposit)."
echo -e "  2. Railway keeper (noetherkeeperbotv2): NEXT_PUBLIC_MARKET_ID=$PROD_MARKET_ID,"
echo -e "     Noeracle-push, NEXT_PUBLIC_NOERACLE_ID. Verify shim lastprice fresh BTC/ETH/XLM."
echo -e "  3. Flip Vercel PRODUCTION env to ALL addresses above (market, vault, router,"
echo -e "     vaultFactory, referral, + shim/noeracle/NOE/USDC/API)."
echo -e "  4. Promote contracts.production.json → contracts.json (deliberate, git-side)."
echo -e "  5. Verify on noether.exchange: a real Freighter trade (fast, no #30) + /vaults + /referrals."
echo ""
