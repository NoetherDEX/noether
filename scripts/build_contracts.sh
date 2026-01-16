#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Noether Smart Contract Build Script
# ═══════════════════════════════════════════════════════════════════════════════
# This script compiles all Soroban smart contracts and optimizes them for deployment.
#
# Usage: ./scripts/build_contracts.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$PROJECT_ROOT/contracts"

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                    Noether Smart Contract Builder                              ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v cargo &> /dev/null; then
    echo -e "${RED}Error: cargo is not installed. Please install Rust.${NC}"
    exit 1
fi

if ! command -v stellar &> /dev/null && ! command -v soroban &> /dev/null; then
    echo -e "${RED}Error: stellar/soroban CLI is not installed.${NC}"
    echo "Install with: cargo install --locked stellar-cli"
    exit 1
fi

# Use stellar CLI if available, otherwise soroban
if command -v stellar &> /dev/null; then
    CLI="stellar"
else
    CLI="soroban"
fi

echo -e "${GREEN}✓ Prerequisites OK${NC}"
echo ""

# Navigate to contracts directory
cd "$CONTRACTS_DIR"

# Build all contracts
echo -e "${YELLOW}Building contracts in release mode...${NC}"
cargo build --release --target wasm32-unknown-unknown

# Check if build was successful
if [ $? -ne 0 ]; then
    echo -e "${RED}Build failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build successful${NC}"
echo ""

# Create output directory for optimized WASM
WASM_DIR="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release"
OPTIMIZED_DIR="$CONTRACTS_DIR/target/wasm"
mkdir -p "$OPTIMIZED_DIR"

# List of contracts to optimize
CONTRACTS=(
    "mock_oracle"
    "oracle_adapter"
    "vault"
    "market"
)

# Optimize each contract
echo -e "${YELLOW}Optimizing WASM files...${NC}"

for contract in "${CONTRACTS[@]}"; do
    WASM_FILE="$WASM_DIR/${contract}.wasm"
    OPTIMIZED_FILE="$OPTIMIZED_DIR/${contract}.wasm"

    if [ -f "$WASM_FILE" ]; then
        echo -n "  Optimizing $contract... "

        # Use stellar/soroban contract optimize
        $CLI contract optimize --wasm "$WASM_FILE" --wasm-out "$OPTIMIZED_FILE" 2>/dev/null || {
            # Fallback: just copy if optimize fails
            cp "$WASM_FILE" "$OPTIMIZED_FILE"
        }

        # Get file sizes
        ORIGINAL_SIZE=$(wc -c < "$WASM_FILE" | tr -d ' ')
        OPTIMIZED_SIZE=$(wc -c < "$OPTIMIZED_FILE" | tr -d ' ')
        SAVINGS=$(( (ORIGINAL_SIZE - OPTIMIZED_SIZE) * 100 / ORIGINAL_SIZE ))

        echo -e "${GREEN}✓${NC} (${OPTIMIZED_SIZE} bytes, ${SAVINGS}% reduction)"
    else
        echo -e "  ${RED}Warning: $contract.wasm not found${NC}"
    fi
done

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                         Build Complete!                                        ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Optimized WASM files are in: $OPTIMIZED_DIR"
echo ""
echo "Contract sizes:"
ls -lh "$OPTIMIZED_DIR"/*.wasm 2>/dev/null || echo "No optimized WASM files found"
