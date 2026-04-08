#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Deploy Market Contract Only
# ═══════════════════════════════════════════════════════════════════════════════
# Deploys only the market contract, initializes it, and links it to the vault.
# Reads existing contract addresses from .env. Does NOT modify .env.
#
# Prerequisites:
#   - Build contracts first: ./scripts/build_contracts.sh
#   - .env must have: ADMIN_SECRET_KEY, NEXT_PUBLIC_ORACLE_ADAPTER_ID,
#     NEXT_PUBLIC_VAULT_ID, NEXT_PUBLIC_USDC_TOKEN_ID
#
# Usage: ./scripts/deploy_market.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WASM_DIR="$PROJECT_ROOT/contracts/target/wasm"

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                    Deploy Market Contract                                      ${NC}"
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

# Validate required variables
if [ -z "$ADMIN_SECRET_KEY" ]; then
    echo -e "${RED}Error: ADMIN_SECRET_KEY not set in .env${NC}"
    exit 1
fi
if [ -z "$NEXT_PUBLIC_ORACLE_ADAPTER_ID" ]; then
    echo -e "${RED}Error: NEXT_PUBLIC_ORACLE_ADAPTER_ID not set in .env${NC}"
    exit 1
fi
if [ -z "$NEXT_PUBLIC_VAULT_ID" ]; then
    echo -e "${RED}Error: NEXT_PUBLIC_VAULT_ID not set in .env${NC}"
    exit 1
fi
if [ -z "$NEXT_PUBLIC_USDC_TOKEN_ID" ]; then
    echo -e "${RED}Error: NEXT_PUBLIC_USDC_TOKEN_ID not set in .env${NC}"
    exit 1
fi

# CLI detection
if command -v stellar &> /dev/null; then
    CLI="stellar"
else
    CLI="soroban"
fi

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

# Check WASM
if [ ! -f "$WASM_DIR/market.wasm" ]; then
    echo -e "${RED}Error: market.wasm not found. Run ./scripts/build_contracts.sh first.${NC}"
    exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Deploy
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}Deploying Market contract...${NC}"
MARKET_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/market.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Market deployed: $MARKET_ID${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Initialize Market
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}Initializing Market...${NC}"
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

# ═══════════════════════════════════════════════════════════════════════════════
# Link Vault → New Market
# ═══════════════════════════════════════════════════════════════════════════════

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

# Read existing values from contracts.json or use .env fallbacks
MOCK_ORACLE_ID="${NEXT_PUBLIC_MOCK_ORACLE_ID}"
ORACLE_ADAPTER_ID="${NEXT_PUBLIC_ORACLE_ADAPTER_ID}"
VAULT_ID="${NEXT_PUBLIC_VAULT_ID}"
USDC_TOKEN_ID="${NEXT_PUBLIC_USDC_TOKEN_ID}"
NOE_TOKEN_ID="${NEXT_PUBLIC_NOE_TOKEN_ID}"

cat > "$PROJECT_ROOT/contracts.json" << EOF
{
  "network": "testnet",
  "deployedAt": "$TIMESTAMP",
  "contracts": {
    "mockOracle": "$MOCK_ORACLE_ID",
    "oracleAdapter": "$ORACLE_ADAPTER_ID",
    "vault": "$VAULT_ID",
    "market": "$MARKET_ID",
    "usdcToken": "$USDC_TOKEN_ID",
    "noeToken": "$NOE_TOKEN_ID"
  },
  "admin": "$ADMIN_PUBLIC_KEY",
  "noeAsset": {
    "code": "NOE",
    "issuer": "$ADMIN_PUBLIC_KEY"
  }
}
EOF
echo -e "${GREEN}✓ New Market address added to contracts.json${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                         Market Deployment Complete!                            ${NC}"
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
