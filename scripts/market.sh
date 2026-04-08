#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Market Contract — Build, Deploy, Initialize (All-in-One)
# ═══════════════════════════════════════════════════════════════════════════════
# Builds, optimizes, deploys, initializes the market contract, and links vault.
# Reads existing contract addresses from .env. Does NOT modify .env.
#
# Usage: ./scripts/market.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$PROJECT_ROOT/contracts"
WASM_DIR="$CONTRACTS_DIR/target/wasm"

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}              Market Contract — Build + Deploy + Initialize                     ${NC}"
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
if [ -z "$ADMIN_SECRET_KEY" ]; then echo -e "${RED}Error: ADMIN_SECRET_KEY not set${NC}"; exit 1; fi
if [ -z "$NEXT_PUBLIC_ORACLE_ADAPTER_ID" ]; then echo -e "${RED}Error: NEXT_PUBLIC_ORACLE_ADAPTER_ID not set${NC}"; exit 1; fi
if [ -z "$NEXT_PUBLIC_VAULT_ID" ]; then echo -e "${RED}Error: NEXT_PUBLIC_VAULT_ID not set${NC}"; exit 1; fi
if [ -z "$NEXT_PUBLIC_USDC_TOKEN_ID" ]; then echo -e "${RED}Error: NEXT_PUBLIC_USDC_TOKEN_ID not set${NC}"; exit 1; fi

# CLI detection
if command -v stellar &> /dev/null; then CLI="stellar"; else CLI="soroban"; fi

# Identity
IDENTITY="noether_admin"
$CLI keys add "$IDENTITY" --secret-key "$ADMIN_SECRET_KEY" 2>/dev/null || true
ADMIN_PUBLIC_KEY=$($CLI keys address "$IDENTITY")

echo -e "${YELLOW}Configuration:${NC}"
echo "  Admin:          $ADMIN_PUBLIC_KEY"
echo "  Oracle Adapter: $NEXT_PUBLIC_ORACLE_ADAPTER_ID"
echo "  Vault:          $NEXT_PUBLIC_VAULT_ID"
echo "  USDC Token:     $NEXT_PUBLIC_USDC_TOKEN_ID"
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

echo -e "${YELLOW}[2/4] Optimizing market.wasm...${NC}"
mkdir -p "$WASM_DIR"
RELEASE_WASM="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release/market.wasm"

if [ ! -f "$RELEASE_WASM" ]; then
    echo -e "${RED}Error: market.wasm not found after build.${NC}"
    exit 1
fi

$CLI contract optimize --wasm "$RELEASE_WASM" --wasm-out "$WASM_DIR/market.wasm" 2>/dev/null || cp "$RELEASE_WASM" "$WASM_DIR/market.wasm"
WASM_SIZE=$(wc -c < "$WASM_DIR/market.wasm" | tr -d ' ')
echo -e "${GREEN}✓ Optimized: ${WASM_SIZE} bytes${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 3: Deploy
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}[3/4] Deploying Market contract...${NC}"
MARKET_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/market.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Market deployed: $MARKET_ID${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 4: Initialize + Link
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}[4/4] Initializing Market...${NC}"
$CLI contract invoke \
    --id "$MARKET_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --oracle_adapter "$NEXT_PUBLIC_ORACLE_ADAPTER_ID" \
    --vault "$NEXT_PUBLIC_VAULT_ID" \
    --usdc_token "$NEXT_PUBLIC_USDC_TOKEN_ID" \
    --config '{"min_collateral":"100000000","max_leverage":10,"maintenance_margin_bps":100,"liquidation_fee_bps":500,"trading_fee_bps":10,"base_funding_rate_bps":1,"max_position_size":"1000000000000","max_price_staleness":60,"max_oracle_deviation_bps":100,"base_maker_fee_bps":2,"base_taker_fee_bps":5}'
echo -e "${GREEN}✓ Market initialized${NC}"

echo ""
echo -e "${YELLOW}Linking Vault to new Market...${NC}"
$CLI contract invoke \
    --id "$NEXT_PUBLIC_VAULT_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- set_market_contract \
    --new_market "$MARKET_ID"
echo -e "${GREEN}✓ Vault linked to new Market${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Update contracts.json
# ═══════════════════════════════════════════════════════════════════════════════

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
cat > "$PROJECT_ROOT/contracts.json" << EOF
{
  "network": "testnet",
  "deployedAt": "$TIMESTAMP",
  "contracts": {
    "mockOracle": "${NEXT_PUBLIC_MOCK_ORACLE_ID}",
    "oracleAdapter": "${NEXT_PUBLIC_ORACLE_ADAPTER_ID}",
    "vault": "${NEXT_PUBLIC_VAULT_ID}",
    "market": "$MARKET_ID",
    "usdcToken": "${NEXT_PUBLIC_USDC_TOKEN_ID}",
    "noeToken": "${NEXT_PUBLIC_NOE_TOKEN_ID}"
  },
  "admin": "$ADMIN_PUBLIC_KEY",
  "noeAsset": {
    "code": "NOE",
    "issuer": "$ADMIN_PUBLIC_KEY"
  }
}
EOF

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                              All Done!                                         ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Here is the new Market contract ---> ${CYAN}$MARKET_ID${NC}"
echo ""
echo -e "  ${GREEN}✓ New Market address added to contracts.json${NC}"
echo ""
echo -e "${RED}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${RED}  DO NOT FORGET TO UPDATE .env FILE                                           ${NC}"
echo -e "${RED}  NEXT_PUBLIC_MARKET_ID=$MARKET_ID${NC}"
echo -e "${RED}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
