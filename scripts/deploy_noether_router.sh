#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Noether Router Contract — Build, Deploy, Initialize (All-in-One)
# ═══════════════════════════════════════════════════════════════════════════════
# The router gives atomic verify-then-trade: in ONE transaction it relays a
# freshly-signed Noeracle price into persistent storage, then calls the
# (untouched) market — which reads that just-stored price through
# oracle_adapter -> noeracle_shim -> get_price_pers. Result: trades execute on a
# sub-second-fresh price and never hit #30 PriceStale, with no market redeploy.
#
# Builds, optimizes, deploys, and initializes noether_router. Reads admin +
# market + Noeracle addresses from .env. Updates contracts.json.
#
# What this DOES NOT do:
# - Switch the frontend onto the router. After deploy, set
#   NEXT_PUBLIC_NOETHER_ROUTER_ID in .env / Vercel; web routes open/close
#   through the router only when that var is set (otherwise it calls the market
#   directly, unchanged).
#
# Usage: ./scripts/deploy_noether_router.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NEON='\033[38;5;198m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$PROJECT_ROOT/contracts"
WASM_DIR="$CONTRACTS_DIR/target/wasm"

DEFAULT_NOERACLE_ID="CAYIP67UDVX5UPXGN3XDAWVIEFBAVG6G7LUESEOU3NUQKTWN55W34YBG"

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}          Noether Router — Build + Deploy + Initialize                          ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Load environment
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
else
    echo -e "${RED}Error: .env file not found.${NC}"
    exit 1
fi

# Validate
if [ -z "$ADMIN_SECRET_KEY" ]; then
    echo -e "${RED}Error: ADMIN_SECRET_KEY not set${NC}"
    exit 1
fi
if [ -z "$NEXT_PUBLIC_MARKET_ID" ]; then
    echo -e "${RED}Error: NEXT_PUBLIC_MARKET_ID not set (router must know the market to call)${NC}"
    exit 1
fi

NOERACLE_ID="${NEXT_PUBLIC_NOERACLE_ID:-$DEFAULT_NOERACLE_ID}"
MARKET_ID="$NEXT_PUBLIC_MARKET_ID"

if command -v stellar &> /dev/null; then CLI="stellar"; else CLI="soroban"; fi

IDENTITY="noether_admin"
$CLI keys add "$IDENTITY" --secret-key "$ADMIN_SECRET_KEY" 2>/dev/null || true
ADMIN_PUBLIC_KEY=$($CLI keys address "$IDENTITY")

echo -e "${YELLOW}Configuration:${NC}"
echo "  Router admin:      $ADMIN_PUBLIC_KEY  (controls set_market / set_noeracle)"
echo "  Market contract:   $MARKET_ID"
echo "  Noeracle contract: $NOERACLE_ID"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 1: Build
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}[1/4] Building contracts...${NC}"
cd "$CONTRACTS_DIR"
cargo build --release --target wasm32-unknown-unknown 2>&1 | tail -3
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 2: Optimize
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}[2/4] Optimizing noether_router.wasm...${NC}"
mkdir -p "$WASM_DIR"
RELEASE_WASM="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release/noether_router.wasm"
if [ ! -f "$RELEASE_WASM" ]; then
    echo -e "${RED}Error: noether_router.wasm not found after build.${NC}"
    exit 1
fi
$CLI contract optimize --wasm "$RELEASE_WASM" --wasm-out "$WASM_DIR/noether_router.wasm" 2>/dev/null \
  || cp "$RELEASE_WASM" "$WASM_DIR/noether_router.wasm"
WASM_SIZE=$(wc -c < "$WASM_DIR/noether_router.wasm" | tr -d ' ')
echo -e "${GREEN}✓ Optimized: ${WASM_SIZE} bytes${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 3: Deploy
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}[3/4] Deploying noether_router contract...${NC}"
ROUTER_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/noether_router.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Router deployed: $ROUTER_ID${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 4: Initialize
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}[4/4] Initializing noether_router...${NC}"
$CLI contract invoke \
    --id "$ROUTER_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --market "$MARKET_ID" \
    --noeracle "$NOERACLE_ID"
echo -e "${GREEN}✓ Router initialized${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Update contracts.json
# ═══════════════════════════════════════════════════════════════════════════════
if command -v jq &> /dev/null && [ -f "$PROJECT_ROOT/contracts.json" ]; then
    TMP=$(mktemp)
    jq --arg router "$ROUTER_ID" \
      '.contracts.noetherRouter = $router' \
      "$PROJECT_ROOT/contracts.json" > "$TMP" && mv "$TMP" "$PROJECT_ROOT/contracts.json"
    echo -e "${GREEN}✓ Added noetherRouter to contracts.json${NC}"
else
    echo -e "${YELLOW}⚠️  jq not installed or contracts.json missing — add manually:${NC}"
    echo -e "      \"noetherRouter\": \"$ROUTER_ID\""
fi
echo ""

echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                             Router Deployed                                    ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Router contract --> ${CYAN}$ROUTER_ID${NC}"
echo ""
echo -e "${NEON}───────────────────────────────────────────────────────────────────────────────${NC}"
echo -e "${NEON}  Turn the router ON for the frontend by setting (web reads it at build time):${NC}"
echo -e "${NEON}  □ .env   □ Vercel${NC}"
echo -e "${NEON}    NEXT_PUBLIC_NOETHER_ROUTER_ID=$ROUTER_ID${NC}"
echo -e "${NEON}───────────────────────────────────────────────────────────────────────────────${NC}"
echo ""
echo -e "${NEON}  Prereqs already in place from the shim deploy:${NC}"
echo -e "${NEON}    • oracle_adapter primary+secondary pointed at the noeracle_shim${NC}"
echo -e "${NEON}    • keeper publishing signed prices to Noeracle persistent storage${NC}"
echo ""
echo -e "${YELLOW}  Note: with the router ON, the trader signs ONE tx whose auth tree covers${NC}"
echo -e "${YELLOW}  router -> market.open_position -> USDC transfer. Verify in a wallet before${NC}"
echo -e "${YELLOW}  flipping it on for all users.${NC}"
echo ""
