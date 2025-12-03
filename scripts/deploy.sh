#!/bin/bash

# ============================================================================
# Noether Protocol - Testnet Deployment Script
# Phase 7: Deployment & Testnet Launch
# ============================================================================

# Don't exit on error - we handle errors manually
# set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NETWORK="testnet"
IDENTITY_NAME="deployer"

# Testnet Oracle Addresses (from Stellar/Soroban ecosystem)
BAND_ORACLE_ADDRESS="CBRV5ZEQSSCQ4FFO64OF46I3UASBVEJNE5C2MCFWVIXL4Z7DMD7PJJMF"
DIA_ORACLE_ADDRESS="CAEDPEZDRCEJCF73ASC5JGNKCIJDV2QJQSW6DJ6B74MYALBNKCJ5IFP4"

# Paths
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS_DIR="$PROJECT_ROOT/contracts"
TARGET_DIR="$PROJECT_ROOT/target/wasm32-unknown-unknown/release"
FRONTEND_CONFIG_DIR="$PROJECT_ROOT/frontend/lib"

# Contract IDs (will be populated during deployment)
USDC_CONTRACT_ID=""
ORACLE_CONTRACT_ID=""
VAULT_CONTRACT_ID=""
MARKET_CONTRACT_ID=""
DEPLOYER_ADDRESS=""

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
    echo ""
    echo -e "${BLUE}============================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================================================${NC}"
    echo ""
}

print_step() {
    echo -e "${YELLOW}>>> $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
    exit 1
}

print_info() {
    echo -e "  $1"
}

# ============================================================================
# Step 1: Build & Optimize Contracts
# ============================================================================

build_contracts() {
    print_header "Step 1: Building & Optimizing Contracts"

    cd "$PROJECT_ROOT"

    # Use Rust 1.80.0 for Soroban compatibility (1.81+ has WASM issues)
    RUST_TOOLCHAIN="1.80.0"

    print_step "Using Rust $RUST_TOOLCHAIN for Soroban compatibility..."

    # Check if toolchain is available
    if ! rustup run $RUST_TOOLCHAIN rustc --version &> /dev/null; then
        print_step "Installing Rust $RUST_TOOLCHAIN..."
        rustup install $RUST_TOOLCHAIN
        rustup target add wasm32-unknown-unknown --toolchain $RUST_TOOLCHAIN
    fi

    print_step "Building all contracts with release profile..."
    cargo +$RUST_TOOLCHAIN build --target wasm32-unknown-unknown --release --locked

    # List built WASM files
    print_step "Built WASM files:"
    for wasm in "$TARGET_DIR"/*.wasm; do
        if [ -f "$wasm" ]; then
            SIZE=$(du -h "$wasm" | cut -f1)
            print_info "$(basename "$wasm") - $SIZE"
        fi
    done

    # Optimize contracts (only non-optimized WASM files)
    print_step "Optimizing contracts..."
    for wasm in "$TARGET_DIR"/*.wasm; do
        # Skip already optimized files
        if [[ "$wasm" == *".optimized"* ]]; then
            continue
        fi
        if [ -f "$wasm" ]; then
            CONTRACT_NAME=$(basename "$wasm" .wasm)
            print_info "Optimizing $CONTRACT_NAME..."
            if command -v stellar &> /dev/null; then
                stellar contract optimize --wasm "$wasm" 2>&1 | grep -E "(Optimized|error)" || true
            elif command -v soroban &> /dev/null; then
                soroban contract optimize --wasm "$wasm" 2>&1 | grep -E "(Optimized|error)" || true
            fi
        fi
    done

    print_success "Contracts built successfully"
}

# ============================================================================
# Step 2: Identity Setup
# ============================================================================

setup_identity() {
    print_header "Step 2: Setting Up Deployer Identity"

    # Check which CLI is available
    if command -v stellar &> /dev/null; then
        CLI="stellar"
    elif command -v soroban &> /dev/null; then
        CLI="soroban"
    else
        print_error "Neither 'stellar' nor 'soroban' CLI found. Please install Stellar CLI."
    fi

    print_step "Using CLI: $CLI"

    # Check if identity exists
    if $CLI keys address "$IDENTITY_NAME" &> /dev/null; then
        print_info "Identity '$IDENTITY_NAME' already exists"
        DEPLOYER_ADDRESS=$($CLI keys address "$IDENTITY_NAME")
    else
        print_step "Creating new identity '$IDENTITY_NAME'..."
        $CLI keys generate "$IDENTITY_NAME" --network "$NETWORK"
        DEPLOYER_ADDRESS=$($CLI keys address "$IDENTITY_NAME")
    fi

    # Always try to fund the account (idempotent - friendbot won't fail if already funded)
    print_step "Funding identity on $NETWORK via Friendbot..."
    print_info "Address: $DEPLOYER_ADDRESS"

    FUND_RESULT=$(curl -s "https://friendbot.stellar.org?addr=$DEPLOYER_ADDRESS")
    if echo "$FUND_RESULT" | grep -q "successful"; then
        print_info "Account funded successfully"
    elif echo "$FUND_RESULT" | grep -q "createAccountAlreadyExist"; then
        print_info "Account already exists and is funded"
    else
        print_info "Friendbot response: $FUND_RESULT"
    fi

    # Wait for the funding to propagate
    sleep 3

    print_info "Deployer Address: $DEPLOYER_ADDRESS"
    print_success "Identity setup complete"
}

# ============================================================================
# Step 3A: Deploy Mock USDC Token
# ============================================================================

deploy_mock_usdc() {
    print_header "Step 3A: Deploying Mock USDC Token"

    if command -v stellar &> /dev/null; then
        CLI="stellar"
    else
        CLI="soroban"
    fi

    # Asset code for our mock USDC
    ASSET_CODE="NUSDC"

    # First, try to get the contract ID if it already exists
    print_step "Checking if NUSDC already exists..."
    print_info "Asset: $ASSET_CODE:$DEPLOYER_ADDRESS"

    # Try to get existing contract ID
    EXISTING_ID=$($CLI contract id asset \
        --asset "$ASSET_CODE:$DEPLOYER_ADDRESS" \
        --network "$NETWORK" 2>&1) || true

    # Check if we got a valid contract ID
    if [[ "$EXISTING_ID" =~ ^C[A-Z0-9]{55}$ ]]; then
        print_info "NUSDC already exists!"
        USDC_CONTRACT_ID="$EXISTING_ID"
    else
        # Deploy new SAC
        print_step "Creating SAC-wrapped token for Mock USDC..."

        DEPLOY_OUTPUT=$($CLI contract asset deploy \
            --asset "$ASSET_CODE:$DEPLOYER_ADDRESS" \
            --network "$NETWORK" \
            --source "$IDENTITY_NAME" 2>&1) || true

        # Extract contract ID from output
        USDC_CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | grep -oE "C[A-Z0-9]{55}" | head -1)

        if [ -z "$USDC_CONTRACT_ID" ]; then
            # Check if it says "already exists" and try to get the ID
            if echo "$DEPLOY_OUTPUT" | grep -q "already exists"; then
                print_info "Contract already exists, fetching ID..."
                USDC_CONTRACT_ID=$($CLI contract id asset \
                    --asset "$ASSET_CODE:$DEPLOYER_ADDRESS" \
                    --network "$NETWORK" 2>&1) || true
            fi
        fi
    fi

    # Final validation - use known ID as fallback
    if [[ ! "$USDC_CONTRACT_ID" =~ ^C[A-Z0-9]{55}$ ]]; then
        print_info "Warning: Could not get valid USDC contract ID"
        print_info "Using previously deployed ID..."
        USDC_CONTRACT_ID="CCTU2UVLLJJPGVNDTMVNEWLNZSLXBYOYCDTV27RYDYFFE7OMPP3FPCJO"
    fi

    print_info "Mock USDC Contract ID: $USDC_CONTRACT_ID"
    print_success "Mock USDC ready"
}

# ============================================================================
# Step 3B: Deploy Oracle Adapter
# ============================================================================

deploy_oracle_adapter() {
    print_header "Step 3B: Deploying Oracle Adapter"

    # Prefer optimized WASM if available
    ORACLE_WASM="$TARGET_DIR/oracle_adapter.optimized.wasm"
    if [ ! -f "$ORACLE_WASM" ]; then
        ORACLE_WASM="$TARGET_DIR/oracle_adapter.wasm"
    fi

    if [ ! -f "$ORACLE_WASM" ]; then
        print_error "Oracle adapter WASM not found"
    fi

    print_info "Using WASM: $(basename $ORACLE_WASM)"

    if command -v stellar &> /dev/null; then
        CLI="stellar"
    else
        CLI="soroban"
    fi

    print_step "Deploying Oracle Adapter contract..."
    print_info "This may take 30-60 seconds..."

    DEPLOY_OUTPUT=$($CLI contract deploy \
        --wasm "$ORACLE_WASM" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" 2>&1)
    DEPLOY_EXIT_CODE=$?

    print_info "Deploy command exit code: $DEPLOY_EXIT_CODE"

    # Extract contract ID (should be a C... string of 56 chars)
    ORACLE_CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | grep -oE "C[A-Z0-9]{55}" | head -1)

    if [ -z "$ORACLE_CONTRACT_ID" ]; then
        print_info "Full deploy output:"
        echo "$DEPLOY_OUTPUT"
        print_error "Failed to deploy Oracle Adapter - no contract ID found"
    fi

    print_info "Oracle Adapter Contract ID: $ORACLE_CONTRACT_ID"
    print_success "Oracle Adapter deployed"
}

# ============================================================================
# Step 3C: Deploy Vault
# ============================================================================

deploy_vault() {
    print_header "Step 3C: Deploying Vault"

    # Prefer optimized WASM if available
    VAULT_WASM="$TARGET_DIR/noether_vault.optimized.wasm"
    if [ ! -f "$VAULT_WASM" ]; then
        VAULT_WASM="$TARGET_DIR/noether_vault.wasm"
    fi
    if [ ! -f "$VAULT_WASM" ]; then
        VAULT_WASM="$TARGET_DIR/vault.wasm"
    fi

    if [ ! -f "$VAULT_WASM" ]; then
        print_error "Vault WASM not found. Tried: noether_vault.optimized.wasm, noether_vault.wasm, vault.wasm"
    fi

    print_info "Using WASM: $(basename $VAULT_WASM)"

    if command -v stellar &> /dev/null; then
        CLI="stellar"
    else
        CLI="soroban"
    fi

    print_step "Deploying Vault contract..."
    print_info "This may take 30-60 seconds..."

    DEPLOY_OUTPUT=$($CLI contract deploy \
        --wasm "$VAULT_WASM" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" 2>&1)
    DEPLOY_EXIT_CODE=$?

    print_info "Deploy command exit code: $DEPLOY_EXIT_CODE"

    # Extract contract ID (should be a C... string of 56 chars)
    VAULT_CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | grep -oE "C[A-Z0-9]{55}" | head -1)

    if [ -z "$VAULT_CONTRACT_ID" ]; then
        print_info "Full deploy output:"
        echo "$DEPLOY_OUTPUT"
        print_error "Failed to deploy Vault - no contract ID found"
    fi

    print_info "Vault Contract ID: $VAULT_CONTRACT_ID"
    print_success "Vault deployed"
}

# ============================================================================
# Step 3D: Deploy Market
# ============================================================================

deploy_market() {
    print_header "Step 3D: Deploying Market"

    # Prefer optimized WASM if available
    MARKET_WASM="$TARGET_DIR/noether_market.optimized.wasm"
    if [ ! -f "$MARKET_WASM" ]; then
        MARKET_WASM="$TARGET_DIR/noether_market.wasm"
    fi
    if [ ! -f "$MARKET_WASM" ]; then
        MARKET_WASM="$TARGET_DIR/market.wasm"
    fi

    if [ ! -f "$MARKET_WASM" ]; then
        print_error "Market WASM not found. Tried: noether_market.optimized.wasm, noether_market.wasm, market.wasm"
    fi

    print_info "Using WASM: $(basename $MARKET_WASM)"

    if command -v stellar &> /dev/null; then
        CLI="stellar"
    else
        CLI="soroban"
    fi

    print_step "Deploying Market contract..."
    print_info "This may take 30-60 seconds..."

    DEPLOY_OUTPUT=$($CLI contract deploy \
        --wasm "$MARKET_WASM" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" 2>&1)
    DEPLOY_EXIT_CODE=$?

    print_info "Deploy command exit code: $DEPLOY_EXIT_CODE"

    # Extract contract ID (should be a C... string of 56 chars)
    MARKET_CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | grep -oE "C[A-Z0-9]{55}" | head -1)

    if [ -z "$MARKET_CONTRACT_ID" ]; then
        print_info "Full deploy output:"
        echo "$DEPLOY_OUTPUT"
        print_error "Failed to deploy Market - no contract ID found"
    fi

    print_info "Market Contract ID: $MARKET_CONTRACT_ID"
    print_success "Market deployed"
}

# ============================================================================
# Step 4A: Initialize Oracle Adapter
# ============================================================================

initialize_oracle() {
    print_header "Step 4A: Initializing Oracle Adapter"

    if command -v stellar &> /dev/null; then
        CLI="stellar"
    else
        CLI="soroban"
    fi

    print_step "Calling oracle_adapter.initialize()..."
    print_info "Admin: $DEPLOYER_ADDRESS"
    print_info "Band Oracle: $BAND_ORACLE_ADDRESS"
    print_info "DIA Oracle: $DIA_ORACLE_ADDRESS"

    $CLI contract invoke \
        --id "$ORACLE_CONTRACT_ID" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" \
        -- \
        initialize \
        --admin "$DEPLOYER_ADDRESS" \
        --band "$BAND_ORACLE_ADDRESS" \
        --dia "$DIA_ORACLE_ADDRESS"

    print_success "Oracle Adapter initialized"
}

# ============================================================================
# Step 4B: Initialize Vault
# ============================================================================

initialize_vault() {
    print_header "Step 4B: Initializing Vault"

    if command -v stellar &> /dev/null; then
        CLI="stellar"
    else
        CLI="soroban"
    fi

    print_step "Calling vault.initialize()..."
    print_info "Admin: $DEPLOYER_ADDRESS"
    print_info "USDC Token: $USDC_CONTRACT_ID"

    $CLI contract invoke \
        --id "$VAULT_CONTRACT_ID" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" \
        -- \
        initialize \
        --admin "$DEPLOYER_ADDRESS" \
        --usdc_token "$USDC_CONTRACT_ID"

    print_success "Vault initialized"
}

# ============================================================================
# Step 4C: Initialize Market
# ============================================================================

initialize_market() {
    print_header "Step 4C: Initializing Market"

    if command -v stellar &> /dev/null; then
        CLI="stellar"
    else
        CLI="soroban"
    fi

    print_step "Calling market.initialize()..."
    print_info "Admin: $DEPLOYER_ADDRESS"
    print_info "Vault: $VAULT_CONTRACT_ID"
    print_info "Oracle: $ORACLE_CONTRACT_ID"
    print_info "USDC Token: $USDC_CONTRACT_ID"

    $CLI contract invoke \
        --id "$MARKET_CONTRACT_ID" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" \
        -- \
        initialize \
        --admin "$DEPLOYER_ADDRESS" \
        --vault "$VAULT_CONTRACT_ID" \
        --oracle "$ORACLE_CONTRACT_ID" \
        --usdc_token "$USDC_CONTRACT_ID"

    print_success "Market initialized"
}

# ============================================================================
# Step 4D: Authorize Market in Vault
# ============================================================================

authorize_market() {
    print_header "Step 4D: Authorizing Market in Vault"

    if command -v stellar &> /dev/null; then
        CLI="stellar"
    else
        CLI="soroban"
    fi

    print_step "Calling vault.set_market_address()..."
    print_info "Market Address: $MARKET_CONTRACT_ID"

    $CLI contract invoke \
        --id "$VAULT_CONTRACT_ID" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" \
        -- \
        set_market_address \
        --market "$MARKET_CONTRACT_ID"

    print_success "Market authorized in Vault"
}

# ============================================================================
# Step 5: Mint Test Tokens
# ============================================================================

mint_test_tokens() {
    print_header "Step 5: Minting Test Tokens"

    if command -v stellar &> /dev/null; then
        CLI="stellar"
    else
        CLI="soroban"
    fi

    # Amount: 10,000 USDC with 7 decimals = 100,000,000,000
    MINT_AMOUNT="100000000000"

    print_step "Minting 10,000 Mock USDC to deployer..."
    print_info "To: $DEPLOYER_ADDRESS"
    print_info "Amount: 10,000 USDC"

    # Try to mint tokens - this depends on the token contract implementation
    $CLI contract invoke \
        --id "$USDC_CONTRACT_ID" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" \
        -- \
        mint \
        --to "$DEPLOYER_ADDRESS" \
        --amount "$MINT_AMOUNT" 2>/dev/null || {
        print_info "Note: Token minting may require admin setup. Skipping..."
    }

    print_success "Test tokens minting attempted"
}

# ============================================================================
# Step 6: Generate Frontend Configuration
# ============================================================================

generate_frontend_config() {
    print_header "Step 6: Generating Frontend Configuration"

    # Ensure frontend config directory exists
    mkdir -p "$FRONTEND_CONFIG_DIR"

    CONFIG_FILE="$FRONTEND_CONFIG_DIR/deployed_contracts.json"

    print_step "Writing contract IDs to $CONFIG_FILE..."

    cat > "$CONFIG_FILE" << EOF
{
  "network": "$NETWORK",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "rpcUrl": "https://soroban-testnet.stellar.org:443",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "deployer": "$DEPLOYER_ADDRESS",
  "contracts": {
    "usdc": "$USDC_CONTRACT_ID",
    "oracle": "$ORACLE_CONTRACT_ID",
    "vault": "$VAULT_CONTRACT_ID",
    "market": "$MARKET_CONTRACT_ID"
  },
  "externalOracles": {
    "band": "$BAND_ORACLE_ADDRESS",
    "dia": "$DIA_ORACLE_ADDRESS"
  }
}
EOF

    print_info "Configuration saved to: $CONFIG_FILE"
    print_success "Frontend configuration generated"
}

# ============================================================================
# Print Summary
# ============================================================================

print_summary() {
    print_header "Deployment Summary"

    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    NOETHER PROTOCOL - DEPLOYED                         ║${NC}"
    echo -e "${GREEN}╠════════════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC} Network:        ${BLUE}$NETWORK${NC}"
    echo -e "${GREEN}║${NC} Deployer:       ${BLUE}$DEPLOYER_ADDRESS${NC}"
    echo -e "${GREEN}╠════════════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC} ${YELLOW}Contract IDs:${NC}"
    echo -e "${GREEN}║${NC}   Mock USDC:    ${BLUE}$USDC_CONTRACT_ID${NC}"
    echo -e "${GREEN}║${NC}   Oracle:       ${BLUE}$ORACLE_CONTRACT_ID${NC}"
    echo -e "${GREEN}║${NC}   Vault:        ${BLUE}$VAULT_CONTRACT_ID${NC}"
    echo -e "${GREEN}║${NC}   Market:       ${BLUE}$MARKET_CONTRACT_ID${NC}"
    echo -e "${GREEN}╠════════════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC} ${YELLOW}External Oracles:${NC}"
    echo -e "${GREEN}║${NC}   Band:         ${BLUE}$BAND_ORACLE_ADDRESS${NC}"
    echo -e "${GREEN}║${NC}   DIA:          ${BLUE}$DIA_ORACLE_ADDRESS${NC}"
    echo -e "${GREEN}╠════════════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC} Config File:    ${BLUE}$FRONTEND_CONFIG_DIR/deployed_contracts.json${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "  1. Update frontend/lib/contracts.ts with the deployed contract IDs"
    echo "  2. Run the frontend: cd frontend && npm run dev"
    echo "  3. Connect your Freighter wallet (use Testnet)"
    echo "  4. Start trading!"
    echo ""
}

# ============================================================================
# Main Execution
# ============================================================================

main() {
    print_header "NOETHER PROTOCOL - TESTNET DEPLOYMENT"
    echo "Starting deployment process..."
    echo "Network: $NETWORK"
    echo "Timestamp: $(date)"

    # Execute deployment steps
    build_contracts
    setup_identity

    # Deploy contracts
    deploy_mock_usdc
    deploy_oracle_adapter
    deploy_vault
    deploy_market

    # Initialize contracts
    initialize_oracle
    initialize_vault
    initialize_market
    authorize_market

    # Post-deployment
    mint_test_tokens
    generate_frontend_config

    # Summary
    print_summary

    print_success "Deployment completed successfully!"
}

# Run main function
main "$@"
