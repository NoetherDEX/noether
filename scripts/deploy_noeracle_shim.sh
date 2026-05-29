#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Noeracle Shim Contract — Build, Deploy, Initialize (All-in-One)
# ═══════════════════════════════════════════════════════════════════════════════
# Builds, optimizes, deploys, and initializes the noeracle_shim contract.
# Reads admin + Noeracle address from .env. Updates contracts.json with the
# new shim address.
#
# What this DOES NOT do:
# - Rewire the existing oracle_adapter (CBDH7R4...) to use the shim. That
#   needs the adapter admin key (GBTHMMFW..., not noether_admin) and is a
#   separate post-deploy step:
#       stellar contract invoke --id $NEXT_PUBLIC_ORACLE_ADAPTER_ID \
#         --source <adapter_admin> --network testnet \
#         -- set_primary_oracle --new_oracle $NEW_SHIM_ID
#       stellar contract invoke --id $NEXT_PUBLIC_ORACLE_ADAPTER_ID \
#         --source <adapter_admin> --network testnet \
#         -- set_secondary_oracle --new_oracle $NEW_SHIM_ID
#
# Usage: ./scripts/deploy_noeracle_shim.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Colors
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

# Noeracle testnet address — the live attestation contract maintained by
# the noeracle.org team. Confirmed against api.noeracle.org and the SDK
# defaults. If they migrate to a new address, override here or via env.
DEFAULT_NOERACLE_ID="CAYIP67UDVX5UPXGN3XDAWVIEFBAVG6G7LUESEOU3NUQKTWN55W34YBG"

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}           Noeracle Shim — Build + Deploy + Initialize                          ${NC}"
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

# Noeracle address: env override → default constant
NOERACLE_ID="${NEXT_PUBLIC_NOERACLE_ID:-$DEFAULT_NOERACLE_ID}"

# CLI detection
if command -v stellar &> /dev/null; then CLI="stellar"; else CLI="soroban"; fi

# Identity
IDENTITY="noether_admin"
$CLI keys add "$IDENTITY" --secret-key "$ADMIN_SECRET_KEY" 2>/dev/null || true
ADMIN_PUBLIC_KEY=$($CLI keys address "$IDENTITY")

echo -e "${YELLOW}Configuration:${NC}"
echo "  Shim admin:        $ADMIN_PUBLIC_KEY  (controls set_noeracle_oracle)"
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

echo -e "${YELLOW}[2/4] Optimizing noeracle_shim.wasm...${NC}"
mkdir -p "$WASM_DIR"
RELEASE_WASM="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release/noeracle_shim.wasm"

if [ ! -f "$RELEASE_WASM" ]; then
    echo -e "${RED}Error: noeracle_shim.wasm not found after build.${NC}"
    exit 1
fi

$CLI contract optimize --wasm "$RELEASE_WASM" --wasm-out "$WASM_DIR/noeracle_shim.wasm" 2>/dev/null \
  || cp "$RELEASE_WASM" "$WASM_DIR/noeracle_shim.wasm"
WASM_SIZE=$(wc -c < "$WASM_DIR/noeracle_shim.wasm" | tr -d ' ')
echo -e "${GREEN}✓ Optimized: ${WASM_SIZE} bytes${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 3: Deploy
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}[3/4] Deploying noeracle_shim contract...${NC}"
SHIM_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/noeracle_shim.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Shim deployed: $SHIM_ID${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 4: Initialize
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}[4/4] Initializing noeracle_shim...${NC}"
$CLI contract invoke \
    --id "$SHIM_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --noeracle_oracle "$NOERACLE_ID"
echo -e "${GREEN}✓ Shim initialized${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Smoke test: call lastprice for BTC (will panic loudly if Noeracle's
# persistent storage is empty or the PriceEntry struct doesn't match what
# the shim expects — both are good failures to catch early).
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}Smoke test: lastprice(BTC) via shim...${NC}"
if SMOKE_OUT=$($CLI contract invoke \
    --id "$SHIM_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- lastprice --asset BTC 2>&1); then
    echo -e "${GREEN}✓ Smoke test passed: $SMOKE_OUT${NC}"
else
    echo -e "${YELLOW}⚠️  Smoke test returned non-success (this is expected if the keeper${NC}"
    echo -e "${YELLOW}    hasn't started pushing to Noeracle persistent storage yet):${NC}"
    echo -e "    $SMOKE_OUT" | tail -5
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Update contracts.json
# ═══════════════════════════════════════════════════════════════════════════════

if command -v jq &> /dev/null && [ -f "$PROJECT_ROOT/contracts.json" ]; then
    TMP=$(mktemp)
    jq --arg shim "$SHIM_ID" --arg noeracle "$NOERACLE_ID" \
      '.contracts.noeracleShim = $shim | .contracts.noeracle = $noeracle' \
      "$PROJECT_ROOT/contracts.json" > "$TMP" && mv "$TMP" "$PROJECT_ROOT/contracts.json"
    echo -e "${GREEN}✓ Added noeracleShim + noeracle to contracts.json${NC}"
else
    echo -e "${YELLOW}⚠️  jq not installed or contracts.json missing — please manually${NC}"
    echo -e "${YELLOW}    add to contracts.json:${NC}"
    echo -e "      \"noeracleShim\": \"$SHIM_ID\","
    echo -e "      \"noeracle\":     \"$NOERACLE_ID\""
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Summary + next steps
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                              Shim Deployed                                     ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Shim contract --> ${CYAN}$SHIM_ID${NC}"
echo ""
echo -e "${NEON}───────────────────────────────────────────────────────────────────────────────${NC}"
echo -e "${NEON}  Sync the new address:${NC}"
echo -e "${NEON}  □ .env   □ Vercel   □ Railway (keeper + api)${NC}"
echo -e "${NEON}    NEXT_PUBLIC_NOERACLE_SHIM_ID=$SHIM_ID${NC}"
echo -e "${NEON}    NEXT_PUBLIC_NOERACLE_ID=$NOERACLE_ID${NC}"
echo -e "${NEON}───────────────────────────────────────────────────────────────────────────────${NC}"
echo ""
echo -e "${NEON}  Next: wire the shim into oracle_adapter ($NEXT_PUBLIC_ORACLE_ADAPTER_ID).${NC}"
echo -e "${NEON}  This needs the adapter admin key (GBTHMMFW...), not noether_admin:${NC}"
echo -e "${NEON}    stellar contract invoke --id \$NEXT_PUBLIC_ORACLE_ADAPTER_ID \\${NC}"
echo -e "${NEON}      --source <adapter_admin> --network testnet \\${NC}"
echo -e "${NEON}      -- set_primary_oracle --new_oracle $SHIM_ID${NC}"
echo -e "${NEON}    stellar contract invoke --id \$NEXT_PUBLIC_ORACLE_ADAPTER_ID \\${NC}"
echo -e "${NEON}      --source <adapter_admin> --network testnet \\${NC}"
echo -e "${NEON}      -- set_secondary_oracle --new_oracle $SHIM_ID${NC}"
echo ""
echo -e "${NEON}  Then restart the keeper so it stops pushing to Mock Oracle and starts${NC}"
echo -e "${NEON}  publishing signed attestations to Noeracle persistent storage instead.${NC}"
echo ""
