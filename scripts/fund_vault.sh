#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Fund Vault Contract with USDC
# ═══════════════════════════════════════════════════════════════════════════════
# Sends USDC from admin wallet to the vault contract.
#
# Usage: ./scripts/fund_vault.sh
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
    echo -e "${RED}Error: ADMIN_SECRET_KEY not set in .env${NC}"
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

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                    Fund Vault Contract                                         ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  From:   $ADMIN_PUBLIC_KEY"
echo "  To:     $NEXT_PUBLIC_VAULT_ID (Vault)"
echo "  Token:  $NEXT_PUBLIC_USDC_TOKEN_ID (USDC)"
echo ""

# Prompt for amount
read -p "Enter USDC amount to send to Vault contract: " USDC_AMOUNT

# Validate input
if [ -z "$USDC_AMOUNT" ]; then
    echo -e "${RED}Error: No amount entered.${NC}"
    exit 1
fi

# Convert float to 7-decimal integer using awk
AMOUNT_SCALED=$(echo "$USDC_AMOUNT" | awk '{printf "%.0f", $1 * 10000000}')

if [ "$AMOUNT_SCALED" -le 0 ] 2>/dev/null; then
    echo -e "${RED}Error: Amount must be greater than 0.${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Sending $USDC_AMOUNT USDC ($AMOUNT_SCALED raw) to Vault...${NC}"

$CLI contract invoke \
    --id "$NEXT_PUBLIC_USDC_TOKEN_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- transfer \
    --from "$ADMIN_PUBLIC_KEY" \
    --to "$NEXT_PUBLIC_VAULT_ID" \
    --amount "$AMOUNT_SCALED"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Successfully sent $USDC_AMOUNT USDC to Vault contract                       ${NC}"
echo -e "${GREEN}  Vault: $NEXT_PUBLIC_VAULT_ID${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
