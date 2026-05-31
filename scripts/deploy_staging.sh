#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Noether GREEN / STAGING deploy (blue-green) — Noeracle-only stack
# ═══════════════════════════════════════════════════════════════════════════════
# Stands up a PARALLEL deployment for staging.noether.exchange WITHOUT touching
# the live contracts or the production keeper. Reads .env.staging (git-ignored).
#
#   Fresh:   NOE (SAC) · vault · market(→ shim) · router
#   Reused:  noeracle_shim (CDHIGZ…) · Noeracle (CAYIP67…) · USDC (CA63EPM4…)
#   Deleted from the live path entirely: mock_oracle, oracle_adapter (not used here)
#
# Resumable: any GREEN_* already set in .env.staging is treated as done and skipped,
# so a re-run continues where a failure left off.
#
# Prereqs:
#   1. cp .env.staging.example .env.staging  and fill in the 2 funded keypairs.
#   2. ./scripts/build_contracts.sh   (or this script builds if WASM missing)
#
# Usage: ./scripts/deploy_staging.sh
#
# Does NOT do (separate steps, see end-of-run notes):
#   - USDC liquidity for the staging admin / vault seeding (faucet + deposit)
#   - Starting the staging keeper
#   - Any Vercel / DNS changes
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NEON='\033[38;5;198m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$PROJECT_ROOT/contracts"
WASM_DIR="$CONTRACTS_DIR/target/wasm"
ENV_FILE="$PROJECT_ROOT/.env.staging"
STAGING_JSON="$PROJECT_ROOT/contracts.staging.json"

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}        Noether GREEN / STAGING deploy — Noeracle-only (blue-green)             ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# ── Load .env.staging ────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}Error: .env.staging not found.${NC}"
  echo -e "  Run: ${CYAN}cp .env.staging.example .env.staging${NC}  then fill in the 2 keypairs."
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

# ── Validate the keypairs are present ─────────────────────────────────────────
need() { if [ -z "${!1:-}" ] || [[ "${!1}" == *PASTE* ]]; then echo -e "${RED}Error: $1 not set in .env.staging${NC}"; exit 1; fi; }
need STAGING_ADMIN_PUBLIC_KEY
need STAGING_ADMIN_SECRET_KEY
need STAGING_KEEPER_PUBLIC_KEY
need STAGING_KEEPER_SECRET_KEY
need NEXT_PUBLIC_NOERACLE_SHIM_ID
need NEXT_PUBLIC_NOERACLE_ID
need NEXT_PUBLIC_USDC_TOKEN_ID

# Distinct-key + sequence-safety guard.
if [ "$STAGING_ADMIN_PUBLIC_KEY" = "$STAGING_KEEPER_PUBLIC_KEY" ]; then
  echo -e "${RED}Error: staging admin and keeper must be DIFFERENT keypairs.${NC}"; exit 1
fi

CLI="$(command -v stellar || command -v soroban)"
ADMIN="staging_admin"; KEEPER="staging_keeper"
$CLI keys add "$ADMIN"  --secret-key "$STAGING_ADMIN_SECRET_KEY"  2>/dev/null || true
$CLI keys add "$KEEPER" --secret-key "$STAGING_KEEPER_SECRET_KEY" 2>/dev/null || true
ADMIN_PK="$($CLI keys address "$ADMIN")"
KEEPER_PK="$($CLI keys address "$KEEPER")"

echo -e "${YELLOW}Configuration:${NC}"
echo "  Staging admin : $ADMIN_PK"
echo "  Staging keeper: $KEEPER_PK"
echo "  Shim (reused) : $NEXT_PUBLIC_NOERACLE_SHIM_ID"
echo "  Noeracle      : $NEXT_PUBLIC_NOERACLE_ID"
echo "  USDC (reused) : $NEXT_PUBLIC_USDC_TOKEN_ID"
echo ""

# ── Funding sanity check (friendbot must have funded both) ────────────────────
echo -e "${YELLOW}Checking both accounts are funded on testnet...${NC}"
for pk in "$ADMIN_PK" "$KEEPER_PK"; do
  if ! curl -s "https://horizon-testnet.stellar.org/accounts/$pk" | grep -q '"account_id"'; then
    echo -e "${RED}Error: $pk is not funded. Fund it: ${CYAN}curl 'https://friendbot.stellar.org/?addr=$pk'${NC}"
    exit 1
  fi
done
echo -e "${GREEN}✓ Both accounts funded${NC}"; echo ""

# ── Helper: persist a GREEN_* var back into .env.staging (resumable) ──────────
save_var() {  # save_var KEY VALUE
  local k="$1" v="$2"
  if grep -q "^$k=" "$ENV_FILE"; then
    # portable in-place edit (macOS + linux)
    local tmp; tmp="$(mktemp)"; sed "s|^$k=.*|$k=$v|" "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
  fi
}

# ── Build (only if WASM missing) ─────────────────────────────────────────────
if [ ! -f "$WASM_DIR/market.wasm" ] || [ ! -f "$WASM_DIR/noether_router.wasm" ] || [ ! -f "$WASM_DIR/vault.wasm" ]; then
  echo -e "${YELLOW}Building contracts...${NC}"
  "$SCRIPT_DIR/build_contracts.sh"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 1. NOE token — fresh SAC-wrapped classic asset (NOE : staging_admin)
#    A new issuer = a DISTINCT asset from the live NOE, so LP accounting is clean.
# ═══════════════════════════════════════════════════════════════════════════════
if [ -z "${GREEN_NOE_TOKEN_ID:-}" ]; then
  echo -e "${YELLOW}[1/5] Deploying green NOE SAC (NOE:$ADMIN_PK)...${NC}"
  GREEN_NOE_TOKEN_ID="$($CLI contract asset deploy --asset "NOE:$ADMIN_PK" --source "$ADMIN" --network testnet)"
  save_var GREEN_NOE_TOKEN_ID "$GREEN_NOE_TOKEN_ID"
  echo -e "${GREEN}✓ NOE: $GREEN_NOE_TOKEN_ID${NC}"
else echo -e "${GREEN}[1/5] NOE already deployed: $GREEN_NOE_TOKEN_ID${NC}"; fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 2. Deploy vault + market + router contracts (ids first; init after).
# ═══════════════════════════════════════════════════════════════════════════════
deploy_wasm() {  # deploy_wasm VARNAME wasm_name
  local var="$1" wasm="$2"
  if [ -z "${!var:-}" ]; then
    local id; id="$($CLI contract deploy --wasm "$WASM_DIR/$wasm" --source "$ADMIN" --network testnet)"
    save_var "$var" "$id"; printf '%s' "$id"
  else printf '%s' "${!var}"; fi
}
echo -e "${YELLOW}[2/5] Deploying vault, market, router...${NC}"
GREEN_VAULT_ID="$(deploy_wasm GREEN_VAULT_ID vault.wasm)";            echo "  vault : $GREEN_VAULT_ID"
GREEN_MARKET_ID="$(deploy_wasm GREEN_MARKET_ID market.wasm)";          echo "  market: $GREEN_MARKET_ID"
GREEN_ROUTER_ID="$(deploy_wasm GREEN_ROUTER_ID noether_router.wasm)";  echo "  router: $GREEN_ROUTER_ID"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 3. Initialize. (idempotent: re-init throws AlreadyInitialized, which we ignore)
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}[3/5] Initializing vault → market(→shim) → router...${NC}"

$CLI contract invoke --id "$GREEN_VAULT_ID" --source "$ADMIN" --network testnet -- initialize \
  --admin "$ADMIN_PK" --usdc_token "$NEXT_PUBLIC_USDC_TOKEN_ID" --market_contract "$GREEN_MARKET_ID" \
  --deposit_fee_bps 30 --withdraw_fee_bps 30 2>/dev/null && echo "  ✓ vault initialized" \
  || echo "  • vault already initialized (skipped)"

# Market reads price via lastprice(Symbol)->(i128,u64); the shim exposes exactly
# that, so oracle_adapter = SHIM_ID. max_price_staleness stays 60s.
CONFIG='{"min_collateral":100000000,"max_leverage":10,"maintenance_margin_bps":100,"liquidation_fee_bps":500,"trading_fee_bps":10,"base_funding_rate_bps":1,"max_position_size":1000000000000,"max_price_staleness":60,"max_oracle_deviation_bps":100,"base_maker_fee_bps":2,"base_taker_fee_bps":5}'
$CLI contract invoke --id "$GREEN_MARKET_ID" --source "$ADMIN" --network testnet -- initialize \
  --admin "$ADMIN_PK" --oracle_adapter "$NEXT_PUBLIC_NOERACLE_SHIM_ID" --vault "$GREEN_VAULT_ID" \
  --usdc_token "$NEXT_PUBLIC_USDC_TOKEN_ID" --config "$CONFIG" 2>/dev/null && echo "  ✓ market initialized (oracle → shim)" \
  || echo "  • market already initialized (skipped)"

$CLI contract invoke --id "$GREEN_ROUTER_ID" --source "$ADMIN" --network testnet -- initialize \
  --admin "$ADMIN_PK" --market "$GREEN_MARKET_ID" --noeracle "$NEXT_PUBLIC_NOERACLE_ID" 2>/dev/null \
  && echo "  ✓ router initialized" || echo "  • router already initialized (skipped)"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 4. Pre-mint NOE to the green vault (SAC issuer = staging admin).
#    Matches the live "pre-mint + transfer" model. Idempotent enough: minting
#    again just adds more; we mint once guarded by a marker var.
# ═══════════════════════════════════════════════════════════════════════════════
if [ -z "${GREEN_NOE_PREMINTED:-}" ]; then
  echo -e "${YELLOW}[4/5] Pre-minting NOE to the green vault...${NC}"
  # 1,000,000,000 NOE * 1e7 precision = 1e16
  $CLI contract invoke --id "$GREEN_NOE_TOKEN_ID" --source "$ADMIN" --network testnet -- \
    mint --to "$GREEN_VAULT_ID" --amount 10000000000000000
  save_var GREEN_NOE_PREMINTED "yes"
  echo -e "${GREEN}✓ Pre-minted 1,000,000,000 NOE to vault${NC}"
else echo -e "${GREEN}[4/5] NOE already pre-minted (skipped)${NC}"; fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 5. Write contracts.staging.json (authoritative green address file).
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}[5/5] Writing contracts.staging.json...${NC}"
TS="$(date '+%Y-%m-%d %H:%M:%S')"
cat > "$STAGING_JSON" <<EOF
{
  "network": "testnet",
  "env": "staging",
  "deployedAt": "$TS",
  "contracts": {
    "market": "$GREEN_MARKET_ID",
    "vault": "$GREEN_VAULT_ID",
    "noeToken": "$GREEN_NOE_TOKEN_ID",
    "noetherRouter": "$GREEN_ROUTER_ID",
    "noeracleShim": "$NEXT_PUBLIC_NOERACLE_SHIM_ID",
    "noeracle": "$NEXT_PUBLIC_NOERACLE_ID",
    "usdcToken": "$NEXT_PUBLIC_USDC_TOKEN_ID"
  },
  "admin": "$ADMIN_PK",
  "keeper": "$KEEPER_PK",
  "noeAsset": { "code": "NOE", "issuer": "$ADMIN_PK" }
}
EOF
echo -e "${GREEN}✓ Wrote $STAGING_JSON${NC}"; echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Summary + next steps
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                      GREEN stack deployed                                      ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  market  → ${CYAN}$GREEN_MARKET_ID${NC}  (oracle = shim)"
echo -e "  vault   → ${CYAN}$GREEN_VAULT_ID${NC}"
echo -e "  NOE     → ${CYAN}$GREEN_NOE_TOKEN_ID${NC}"
echo -e "  router  → ${CYAN}$GREEN_ROUTER_ID${NC}"
echo ""
echo -e "${NEON}Next:${NC}"
echo -e "  1. Seed vault USDC liquidity (vault is counterparty to every trade):"
echo -e "       • get testnet USDC for the staging admin ($ADMIN_PK) via the faucet"
echo -e "       • then deposit into the vault: vault.deposit(admin, amount)"
echo -e "  2. Start the staging keeper (pushes BTC/ETH/XLM to Noeracle persistent):"
echo -e "       run the keeper with STAGING_KEEPER_SECRET_KEY + green NEXT_PUBLIC_MARKET_ID"
echo -e "  3. Vercel Preview env vars → green addresses above (+ router + shim + noeracle)."
echo -e "  4. Merge feature/noeracle-integration → staging; attach staging.noether.exchange."
echo ""
