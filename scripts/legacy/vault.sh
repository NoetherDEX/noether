#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# RETIRED 2026-07-04 (audit D-5 / TASKS.md P3-2).
#
# This script predates the Noeracle cutover. It requires deleted WASM,
# omits new init args, and OVERWRITES the authoritative contracts.json
# with a manifest missing router/vaultFactory/referral — one run
# corrupts the address file the api/indexer Docker images bake in.
#
# Use the current tooling instead:
#   ./scripts/deploy_staging.sh     (blue-green testnet deploy → verify → promote)
#   ./scripts/deploy_production.sh  (production stack)
#   ./scripts/deploy_noeracle_shim.sh / deploy_noether_router.sh
#
# The original is preserved below the guard for reference only.
# ═══════════════════════════════════════════════════════════════════════
echo "REFUSING: vault.sh is retired — see scripts/legacy/README.md (audit D-5)." >&2
exit 1

# ═══════════════════════════════════════════════════════════════════════════════
# Vault Contract — Build, Deploy, Initialize (All-in-One)
# ═══════════════════════════════════════════════════════════════════════════════
# Builds, optimizes, deploys, and initializes the vault contract.
# Reads existing contract addresses from .env. Does NOT modify .env.
#
# Usage: ./scripts/vault.sh
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
echo -e "${CYAN}              Vault Contract — Build + Deploy + Initialize                      ${NC}"
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
if [ -z "$NEXT_PUBLIC_MARKET_ID" ]; then echo -e "${RED}Error: NEXT_PUBLIC_MARKET_ID not set${NC}"; exit 1; fi
if [ -z "$NEXT_PUBLIC_USDC_TOKEN_ID" ]; then echo -e "${RED}Error: NEXT_PUBLIC_USDC_TOKEN_ID not set${NC}"; exit 1; fi

# CLI detection
if command -v stellar &> /dev/null; then CLI="stellar"; else CLI="soroban"; fi

# Identity
IDENTITY="noether_admin"
$CLI keys add "$IDENTITY" --secret-key "$ADMIN_SECRET_KEY" 2>/dev/null || true
ADMIN_PUBLIC_KEY=$($CLI keys address "$IDENTITY")

echo -e "${YELLOW}Configuration:${NC}"
echo "  Admin:      $ADMIN_PUBLIC_KEY"
echo "  Market:     $NEXT_PUBLIC_MARKET_ID"
echo "  USDC Token: $NEXT_PUBLIC_USDC_TOKEN_ID"
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

echo -e "${YELLOW}[2/4] Optimizing vault.wasm...${NC}"
mkdir -p "$WASM_DIR"
RELEASE_WASM="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release/vault.wasm"

if [ ! -f "$RELEASE_WASM" ]; then
    echo -e "${RED}Error: vault.wasm not found after build.${NC}"
    exit 1
fi

$CLI contract optimize --wasm "$RELEASE_WASM" --wasm-out "$WASM_DIR/vault.wasm" 2>/dev/null || cp "$RELEASE_WASM" "$WASM_DIR/vault.wasm"
WASM_SIZE=$(wc -c < "$WASM_DIR/vault.wasm" | tr -d ' ')
echo -e "${GREEN}✓ Optimized: ${WASM_SIZE} bytes${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 3: Deploy
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}[3/4] Deploying Vault contract...${NC}"
VAULT_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/vault.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Vault deployed: $VAULT_ID${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 4: Initialize
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}[4/4] Initializing Vault...${NC}"
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
cat > "$PROJECT_ROOT/contracts.json" << EOF
{
  "network": "testnet",
  "deployedAt": "$TIMESTAMP",
  "contracts": {
    "mockOracle": "${NEXT_PUBLIC_MOCK_ORACLE_ID}",
    "oracleAdapter": "${NEXT_PUBLIC_ORACLE_ADAPTER_ID}",
    "vault": "$VAULT_ID",
    "market": "${NEXT_PUBLIC_MARKET_ID}",
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
echo -e "  Here is the new Vault contract ---> ${CYAN}$VAULT_ID${NC}"
echo ""
echo -e "  ${GREEN}✓ New Vault address added to contracts.json${NC}"
echo ""
echo -e "${RED}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${RED}  DO NOT FORGET TO UPDATE .env FILE                                           ${NC}"
echo -e "${RED}  NEXT_PUBLIC_VAULT_ID=$VAULT_ID${NC}"
echo -e "${RED}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
