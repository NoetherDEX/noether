#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Noether Testnet Deployment Script
# ═══════════════════════════════════════════════════════════════════════════════
# Deploys all Noether contracts to Stellar Testnet.
#
# Prerequisites:
#   - Build contracts first: ./scripts/build_contracts.sh
#   - Set up .env file with ADMIN_SECRET_KEY
#
# Usage: ./scripts/deploy_testnet.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WASM_DIR="$PROJECT_ROOT/contracts/target/wasm"

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                    Noether Testnet Deployment                                  ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Load environment
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
else
    echo -e "${RED}Error: .env file not found. Please copy .env.example to .env and configure it.${NC}"
    exit 1
fi

# Validate required variables
if [ -z "$ADMIN_SECRET_KEY" ]; then
    echo -e "${RED}Error: ADMIN_SECRET_KEY not set in .env${NC}"
    exit 1
fi

# Use stellar CLI if available
if command -v stellar &> /dev/null; then
    CLI="stellar"
else
    CLI="soroban"
fi

# Network configuration
NETWORK="testnet"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

echo -e "${YELLOW}Configuration:${NC}"
echo "  Network: $NETWORK"
echo "  RPC URL: $RPC_URL"
echo ""

# Check WASM files exist
echo -e "${YELLOW}Checking WASM files...${NC}"
for contract in mock_oracle oracle_adapter vault market; do
    if [ ! -f "$WASM_DIR/${contract}.wasm" ]; then
        echo -e "${RED}Error: $contract.wasm not found. Run ./scripts/build_contracts.sh first.${NC}"
        exit 1
    fi
done
echo -e "${GREEN}✓ All WASM files present${NC}"
echo ""

# Create identity if not exists
IDENTITY="noether_admin"
echo -e "${YELLOW}Setting up identity: $IDENTITY${NC}"
$CLI keys add "$IDENTITY" --secret-key "$ADMIN_SECRET_KEY" 2>/dev/null || true
ADMIN_PUBLIC_KEY=$($CLI keys address "$IDENTITY")
echo "  Admin address: $ADMIN_PUBLIC_KEY"
echo ""

# Fund account if needed (testnet only)
echo -e "${YELLOW}Checking account balance...${NC}"
$CLI keys fund "$IDENTITY" --network testnet 2>/dev/null || echo "Account already funded or funding not available"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Deploy Contracts
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                         Deploying Contracts                                    ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Noeracle attestation contract (signed price source). Override via env if needed.
NOERACLE_ID="${NEXT_PUBLIC_NOERACLE_ID:-CAYIP67UDVX5UPXGN3XDAWVIEFBAVG6G7LUESEOU3NUQKTWN55W34YBG}"

# 1. Deploy Noeracle Shim (SEP-40 reader → Noeracle.get_price_pers)
echo -e "${YELLOW}[1/4] Deploying Noeracle Shim...${NC}"
NOERACLE_SHIM_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/noeracle_shim.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Noeracle Shim deployed: $NOERACLE_SHIM_ID${NC}"

# Initialize the shim: admin + the Noeracle attestation contract it reads from.
echo "  Initializing Noeracle Shim..."
$CLI contract invoke \
    --id "$NOERACLE_SHIM_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --noeracle_oracle "$NOERACLE_ID"
echo -e "${GREEN}✓ Noeracle Shim initialized (reads $NOERACLE_ID)${NC}"
echo ""

# 2. (Oracle prices come from the keeper publishing signed Noeracle attestations;
#     no separate oracle contract is deployed in the Noeracle-only stack.)
echo -e "${YELLOW}[2/4] Oracle = Noeracle (no adapter/mock to deploy)${NC}"
echo ""

# 3. Deploy Vault
echo -e "${YELLOW}[3/4] Deploying Vault...${NC}"
VAULT_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/vault.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Vault deployed: $VAULT_ID${NC}"
echo ""

# 4. Deploy Market
echo -e "${YELLOW}[4/4] Deploying Market...${NC}"
MARKET_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/market.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Market deployed: $MARKET_ID${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Initialize Remaining Contracts
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                      Initializing Contracts                                    ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Deploy a test USDC token (for testnet)
echo -e "${YELLOW}Deploying test USDC token...${NC}"
# For testnet, we'll use the native asset as a placeholder
# In production, this would be the official USDC token
USDC_TOKEN_ID="${USDC_TOKEN_ID:-$($CLI contract asset deploy --asset native --source $IDENTITY --network testnet 2>/dev/null || echo 'NATIVE')}"
echo -e "${GREEN}✓ USDC Token: $USDC_TOKEN_ID${NC}"
echo ""

# Initialize Vault
echo -e "${YELLOW}Initializing Vault...${NC}"
$CLI contract invoke \
    --id "$VAULT_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --usdc_token "$USDC_TOKEN_ID" \
    --market_contract "$MARKET_ID" \
    --deposit_fee_bps 30 \
    --withdraw_fee_bps 30
echo -e "${GREEN}✓ Vault initialized${NC}"
echo ""

# Initialize Market
echo -e "${YELLOW}Initializing Market...${NC}"

# Market config in JSON format for complex struct
CONFIG='{
    "min_collateral": 100000000,
    "max_leverage": 10,
    "maintenance_margin_bps": 100,
    "liquidation_fee_bps": 500,
    "trading_fee_bps": 10,
    "base_funding_rate_bps": 1,
    "max_position_size": 1000000000000,
    "max_price_staleness": 60,
    "max_oracle_deviation_bps": 100,
    "base_maker_fee_bps": 2,
    "base_taker_fee_bps": 5
}'

$CLI contract invoke \
    --id "$MARKET_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --oracle_adapter "$NOERACLE_SHIM_ID" \
    --vault "$VAULT_ID" \
    --usdc_token "$USDC_TOKEN_ID" \
    --config "$CONFIG"
echo -e "${GREEN}✓ Market initialized${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Save Contract IDs
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                       Saving Contract IDs                                      ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Save to contracts.json
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
cat > "$PROJECT_ROOT/contracts.json" << EOF
{
  "network": "testnet",
  "deployedAt": "$TIMESTAMP",
  "contracts": {
    "noeracleShim": "$NOERACLE_SHIM_ID",
    "noeracle": "$NOERACLE_ID",
    "vault": "$VAULT_ID",
    "market": "$MARKET_ID",
    "usdcToken": "$USDC_TOKEN_ID"
  },
  "admin": "$ADMIN_PUBLIC_KEY"
}
EOF
echo -e "${GREEN}Contract IDs saved to contracts.json${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                      Deployment Complete!                                      ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${CYAN}Contract Addresses:${NC}"
echo "  Noeracle Shim:  $NOERACLE_SHIM_ID"
echo "  Noeracle:       $NOERACLE_ID"
echo "  Vault:          $VAULT_ID"
echo "  Market:         $MARKET_ID"
echo "  USDC Token:     $USDC_TOKEN_ID"
echo ""
echo -e "${CYAN}Admin:${NC} $ADMIN_PUBLIC_KEY"
echo ""
echo ""
echo -e "${RED}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${RED}  DO NOT FORGET TO UPDATE .env FILE WITH THE NEW CONTRACT ADDRESSES ABOVE     ${NC}"
echo -e "${RED}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Update .env with the new contract addresses"
echo "  2. Start the frontend: cd web && npm run dev"
echo "  3. Start the keeper bot: cd scripts/keeper && npm start"
echo ""
