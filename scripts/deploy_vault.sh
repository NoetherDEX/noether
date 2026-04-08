#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Deploy Vault Contract Only
# ═══════════════════════════════════════════════════════════════════════════════
# Deploys only the vault contract, initializes it, and links it to the market.
# Reads existing contract addresses from .env. Does NOT modify .env.
#
# Prerequisites:
#   - Build contracts first: ./scripts/build_contracts.sh
#   - .env must have: ADMIN_SECRET_KEY, NEXT_PUBLIC_MARKET_ID,
#     NEXT_PUBLIC_USDC_TOKEN_ID, NEXT_PUBLIC_NOE_TOKEN_ID
#
# Usage: ./scripts/deploy_vault.sh
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
echo -e "${CYAN}                    Deploy Vault Contract                                       ${NC}"
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
if [ -z "$NEXT_PUBLIC_MARKET_ID" ]; then
    echo -e "${RED}Error: NEXT_PUBLIC_MARKET_ID not set in .env${NC}"
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
echo "  Admin:      $ADMIN_PUBLIC_KEY"
echo "  Market:     $NEXT_PUBLIC_MARKET_ID"
echo "  USDC Token: $NEXT_PUBLIC_USDC_TOKEN_ID"
echo ""

# Check WASM
if [ ! -f "$WASM_DIR/vault.wasm" ]; then
    echo -e "${RED}Error: vault.wasm not found. Run ./scripts/build_contracts.sh first.${NC}"
    exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Deploy
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}Deploying Vault contract...${NC}"
VAULT_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/vault.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Vault deployed: $VAULT_ID${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Initialize Vault
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}Initializing Vault...${NC}"
$CLI contract invoke \
    --id "$VAULT_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --usdc_token "$NEXT_PUBLIC_USDC_TOKEN_ID" \
    --market_contract "$NEXT_PUBLIC_MARKET_ID" \
    --deposit_fee_bps 30 \
    --withdraw_fee_bps 30
echo -e "${GREEN}✓ Vault initialized${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Update contracts.json
# ═══════════════════════════════════════════════════════════════════════════════

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

MOCK_ORACLE_ID="${NEXT_PUBLIC_MOCK_ORACLE_ID}"
ORACLE_ADAPTER_ID="${NEXT_PUBLIC_ORACLE_ADAPTER_ID}"
MARKET_ID="${NEXT_PUBLIC_MARKET_ID}"
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
echo -e "${GREEN}✓ New Vault address added to contracts.json${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                         Vault Deployment Complete!                              ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Here is the new Vault contract ---> ${CYAN}$VAULT_ID${NC}"
echo ""
echo -e "  ${GREEN}✓ New Vault address added to contracts.json${NC}"
echo ""
echo -e "${RED}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${RED}  DO NOT FORGET TO UPDATE .env FILE                                           ${NC}"
echo -e "${RED}  NEXT_PUBLIC_VAULT_ID=$VAULT_ID${NC}"
echo -e "${RED}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
