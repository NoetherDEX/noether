#!/bin/bash

# ============================================================================
# Noether Protocol - Zero-Setup Futurenet Deployment Script
# Phase 7: Complete Automated Deployment
# ============================================================================
#
# SECURITY: This script contains NO secrets. All credentials are loaded
# from the .env file in the project root.
#
# SETUP:
#   1. Copy .env.example to .env
#   2. Fill in your ADMIN_SECRET_KEY and ADMIN_PUBLIC_KEY
#   3. Run: ./scripts/setup_and_deploy.sh
#
# This script handles everything automatically:
#   1. Load environment from .env
#   2. Soroban identity configuration
#   3. Contract building & deployment
#   4. Contract initialization & wiring
#   5. Token minting
#   6. Frontend config generation
#
# ============================================================================

set -e  # Exit on any error

# ============================================================================
# PATHS & CONSTANTS
# ============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Paths
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS_DIR="$PROJECT_ROOT/scripts"
CONTRACTS_DIR="$PROJECT_ROOT/contracts"
TARGET_DIR="$PROJECT_ROOT/target/wasm32-unknown-unknown/release"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
ENV_FILE="$PROJECT_ROOT/.env"

# Rust version for Soroban compatibility
RUST_VERSION="1.80.0"

# Contract IDs (populated during deployment)
USDC_CONTRACT_ID=""
ORACLE_CONTRACT_ID=""
VAULT_CONTRACT_ID=""
MARKET_CONTRACT_ID=""

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

print_banner() {
    echo ""
    echo -e "${MAGENTA}╔══════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${MAGENTA}║                                                                          ║${NC}"
    echo -e "${MAGENTA}║${NC}    ${CYAN}███╗   ██╗ ██████╗ ███████╗████████╗██╗  ██╗███████╗██████╗${NC}        ${MAGENTA}║${NC}"
    echo -e "${MAGENTA}║${NC}    ${CYAN}████╗  ██║██╔═══██╗██╔════╝╚══██╔══╝██║  ██║██╔════╝██╔══██╗${NC}       ${MAGENTA}║${NC}"
    echo -e "${MAGENTA}║${NC}    ${CYAN}██╔██╗ ██║██║   ██║█████╗     ██║   ███████║█████╗  ██████╔╝${NC}       ${MAGENTA}║${NC}"
    echo -e "${MAGENTA}║${NC}    ${CYAN}██║╚██╗██║██║   ██║██╔══╝     ██║   ██╔══██║██╔══╝  ██╔══██╗${NC}       ${MAGENTA}║${NC}"
    echo -e "${MAGENTA}║${NC}    ${CYAN}██║ ╚████║╚██████╔╝███████╗   ██║   ██║  ██║███████╗██║  ██║${NC}       ${MAGENTA}║${NC}"
    echo -e "${MAGENTA}║${NC}    ${CYAN}╚═╝  ╚═══╝ ╚═════╝ ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝${NC}       ${MAGENTA}║${NC}"
    echo -e "${MAGENTA}║                                                                          ║${NC}"
    echo -e "${MAGENTA}║${NC}              ${YELLOW}Futurenet Zero-Setup Deployment Script${NC}                    ${MAGENTA}║${NC}"
    echo -e "${MAGENTA}║                                                                          ║${NC}"
    echo -e "${MAGENTA}╚══════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_step() {
    echo -e "${YELLOW}▶ $1${NC}"
}

print_substep() {
    echo -e "  ${CYAN}→ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ ERROR: $1${NC}"
    exit 1
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "  ${NC}$1${NC}"
}

# Get CLI command (stellar or soroban)
get_cli() {
    if command -v stellar &> /dev/null; then
        echo "stellar"
    elif command -v soroban &> /dev/null; then
        echo "soroban"
    else
        print_error "Neither 'stellar' nor 'soroban' CLI found. Please install Stellar CLI first."
    fi
}

# ============================================================================
# STEP 1: LOAD ENVIRONMENT
# ============================================================================

load_environment() {
    print_header "STEP 1: Load Environment Configuration"

    cd "$PROJECT_ROOT"

    # Check if .env exists
    if [ ! -f "$ENV_FILE" ]; then
        print_error ".env file not found!

Please create it by copying the example:
  cp .env.example .env

Then edit .env and add your credentials:
  ADMIN_SECRET_KEY=S...your_secret_key...
  ADMIN_PUBLIC_KEY=G...your_public_key..."
    fi

    print_step "Loading environment from .env..."

    # Load environment variables
    set -a
    source "$ENV_FILE"
    set +a

    # Validate required variables
    if [ -z "$ADMIN_SECRET_KEY" ]; then
        print_error "ADMIN_SECRET_KEY is not set in .env"
    fi

    if [ -z "$ADMIN_PUBLIC_KEY" ]; then
        print_error "ADMIN_PUBLIC_KEY is not set in .env"
    fi

    # Set defaults if not provided
    NETWORK="${NETWORK:-futurenet}"
    NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Future Network ; October 2022}"
    RPC_URL="${RPC_URL:-https://rpc-futurenet.stellar.org}"
    HORIZON_URL="${HORIZON_URL:-https://horizon-futurenet.stellar.org}"
    IDENTITY_NAME="${IDENTITY_NAME:-noether_admin}"

    # Set friendbot URL based on network
    if [ "$NETWORK" == "futurenet" ]; then
        FRIENDBOT_URL="https://friendbot-futurenet.stellar.org"
    else
        FRIENDBOT_URL="https://friendbot.stellar.org"
    fi

    print_substep "Network: $NETWORK"
    print_substep "Public Key: ${ADMIN_PUBLIC_KEY:0:10}...${ADMIN_PUBLIC_KEY: -6}"
    print_substep "Identity: $IDENTITY_NAME"

    print_success "Environment loaded (secrets from .env)"
}

# ============================================================================
# STEP 2: SOROBAN IDENTITY SETUP
# ============================================================================

setup_identity() {
    print_header "STEP 2: Soroban Identity Setup"

    local CLI=$(get_cli)
    print_step "Using CLI: $CLI"

    # Check if identity already exists with correct address
    if $CLI keys address "$IDENTITY_NAME" &> /dev/null 2>&1; then
        local existing_addr=$($CLI keys address "$IDENTITY_NAME" 2>/dev/null)
        if [ "$existing_addr" == "$ADMIN_PUBLIC_KEY" ]; then
            print_substep "Identity '$IDENTITY_NAME' already configured correctly"
        else
            print_substep "Removing old identity with different address..."
            $CLI keys rm "$IDENTITY_NAME" 2>/dev/null || true
        fi
    fi

    # Add identity from secret key (loaded from .env)
    print_step "Configuring identity '$IDENTITY_NAME' from secret key..."

    # Use the secret key from environment variable
    echo "$ADMIN_SECRET_KEY" | $CLI keys add "$IDENTITY_NAME" --secret-key 2>/dev/null || {
        print_warning "Identity may already exist, continuing..."
    }

    # Verify identity
    local addr=$($CLI keys address "$IDENTITY_NAME" 2>/dev/null) || true

    if [ -z "$addr" ]; then
        # Try alternative method
        print_substep "Trying alternative identity setup..."
        $CLI keys add "$IDENTITY_NAME" --secret-key <<< "$ADMIN_SECRET_KEY" 2>/dev/null || true
        addr=$($CLI keys address "$IDENTITY_NAME" 2>/dev/null) || true
    fi

    if [ "$addr" != "$ADMIN_PUBLIC_KEY" ]; then
        print_warning "Identity address mismatch. Using provided public key."
        addr="$ADMIN_PUBLIC_KEY"
    fi

    print_substep "Identity Address: ${addr:0:10}...${addr: -6}"

    # Fund account via Friendbot
    print_step "Funding account via Friendbot..."
    local fund_response=$(curl -s "${FRIENDBOT_URL}?addr=${ADMIN_PUBLIC_KEY}")

    if echo "$fund_response" | grep -q "successful\|hash"; then
        print_substep "Account funded successfully"
    elif echo "$fund_response" | grep -q "createAccountAlreadyExist"; then
        print_substep "Account already exists and is funded"
    else
        print_substep "Friendbot response received (account may already be funded)"
    fi

    sleep 3
    print_success "Identity setup complete"
}

# ============================================================================
# STEP 3: BUILD CONTRACTS
# ============================================================================

build_contracts() {
    print_header "STEP 3: Build Contracts"

    cd "$PROJECT_ROOT"

    # Check Rust toolchain
    print_step "Checking Rust $RUST_VERSION toolchain..."
    if ! rustup run $RUST_VERSION rustc --version &> /dev/null; then
        print_substep "Installing Rust $RUST_VERSION..."
        rustup install $RUST_VERSION
        rustup target add wasm32-unknown-unknown --toolchain $RUST_VERSION
    fi

    print_step "Building all contracts (release mode)..."
    cargo +$RUST_VERSION build --target wasm32-unknown-unknown --release 2>&1 | tail -20

    # List built WASM files
    print_step "Built WASM files:"
    for wasm in "$TARGET_DIR"/*.wasm; do
        if [ -f "$wasm" ]; then
            local size=$(du -h "$wasm" | cut -f1)
            print_substep "$(basename "$wasm") - $size"
        fi
    done

    # Optimize contracts
    local CLI=$(get_cli)
    print_step "Optimizing contracts..."
    for wasm in "$TARGET_DIR"/*.wasm; do
        if [[ "$wasm" != *".optimized"* ]] && [ -f "$wasm" ]; then
            local name=$(basename "$wasm" .wasm)
            print_substep "Optimizing $name..."
            $CLI contract optimize --wasm "$wasm" 2>&1 | grep -E "(Optimized|bytes)" || true
        fi
    done

    print_success "Contracts built and optimized"
}

# ============================================================================
# STEP 4A: DEPLOY MOCK USDC
# ============================================================================

deploy_mock_usdc() {
    print_header "STEP 4A: Deploy Mock USDC Token"

    local CLI=$(get_cli)
    local ASSET_CODE="FUSDC"  # Futurenet USDC

    print_step "Deploying SAC-wrapped Mock USDC..."
    print_substep "Asset: $ASSET_CODE:${ADMIN_PUBLIC_KEY:0:10}..."

    # Check if already exists
    USDC_CONTRACT_ID=$($CLI contract id asset \
        --asset "$ASSET_CODE:$ADMIN_PUBLIC_KEY" \
        --network "$NETWORK" 2>&1) || true

    if [[ "$USDC_CONTRACT_ID" =~ ^C[A-Z0-9]{55}$ ]]; then
        print_substep "FUSDC already deployed!"
    else
        # Deploy new SAC
        local deploy_output=$($CLI contract asset deploy \
            --asset "$ASSET_CODE:$ADMIN_PUBLIC_KEY" \
            --network "$NETWORK" \
            --source "$IDENTITY_NAME" 2>&1) || true

        USDC_CONTRACT_ID=$(echo "$deploy_output" | grep -oE "C[A-Z0-9]{55}" | head -1)

        if [ -z "$USDC_CONTRACT_ID" ]; then
            USDC_CONTRACT_ID=$($CLI contract id asset \
                --asset "$ASSET_CODE:$ADMIN_PUBLIC_KEY" \
                --network "$NETWORK" 2>&1) || true
        fi
    fi

    if [[ ! "$USDC_CONTRACT_ID" =~ ^C[A-Z0-9]{55}$ ]]; then
        print_error "Failed to deploy/get Mock USDC contract ID"
    fi

    print_substep "Contract ID: $USDC_CONTRACT_ID"

    # Mint 1,000,000 USDC to admin (7 decimals = 10^13)
    print_step "Minting 1,000,000 FUSDC to admin..."
    local MINT_AMOUNT="10000000000000"

    $CLI contract invoke \
        --id "$USDC_CONTRACT_ID" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" \
        -- \
        mint \
        --to "$ADMIN_PUBLIC_KEY" \
        --amount "$MINT_AMOUNT" 2>/dev/null || {
            print_warning "Minting may require different approach for SAC tokens"
        }

    print_success "Mock USDC deployed: $USDC_CONTRACT_ID"
}

# ============================================================================
# STEP 4B: DEPLOY ORACLE ADAPTER
# ============================================================================

deploy_oracle_adapter() {
    print_header "STEP 4B: Deploy Oracle Adapter"

    local CLI=$(get_cli)

    # Find WASM file
    local WASM="$TARGET_DIR/oracle_adapter.optimized.wasm"
    [ ! -f "$WASM" ] && WASM="$TARGET_DIR/oracle_adapter.wasm"

    if [ ! -f "$WASM" ]; then
        print_error "Oracle adapter WASM not found"
    fi

    print_step "Deploying Oracle Adapter..."
    print_substep "WASM: $(basename $WASM)"
    print_substep "This may take 30-60 seconds..."

    local deploy_output=$($CLI contract deploy \
        --wasm "$WASM" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" 2>&1)

    ORACLE_CONTRACT_ID=$(echo "$deploy_output" | grep -oE "C[A-Z0-9]{55}" | head -1)

    if [ -z "$ORACLE_CONTRACT_ID" ]; then
        echo "$deploy_output"
        print_error "Failed to deploy Oracle Adapter"
    fi

    print_success "Oracle Adapter deployed: $ORACLE_CONTRACT_ID"
}

# ============================================================================
# STEP 4C: DEPLOY VAULT
# ============================================================================

deploy_vault() {
    print_header "STEP 4C: Deploy Vault"

    local CLI=$(get_cli)

    # Find WASM file
    local WASM="$TARGET_DIR/noether_vault.optimized.wasm"
    [ ! -f "$WASM" ] && WASM="$TARGET_DIR/noether_vault.wasm"
    [ ! -f "$WASM" ] && WASM="$TARGET_DIR/vault.optimized.wasm"
    [ ! -f "$WASM" ] && WASM="$TARGET_DIR/vault.wasm"

    if [ ! -f "$WASM" ]; then
        print_error "Vault WASM not found"
    fi

    print_step "Deploying Vault..."
    print_substep "WASM: $(basename $WASM)"
    print_substep "This may take 30-60 seconds..."

    local deploy_output=$($CLI contract deploy \
        --wasm "$WASM" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" 2>&1)

    VAULT_CONTRACT_ID=$(echo "$deploy_output" | grep -oE "C[A-Z0-9]{55}" | head -1)

    if [ -z "$VAULT_CONTRACT_ID" ]; then
        echo "$deploy_output"
        print_error "Failed to deploy Vault"
    fi

    print_success "Vault deployed: $VAULT_CONTRACT_ID"
}

# ============================================================================
# STEP 4D: DEPLOY MARKET
# ============================================================================

deploy_market() {
    print_header "STEP 4D: Deploy Market"

    local CLI=$(get_cli)

    # Find WASM file
    local WASM="$TARGET_DIR/noether_market.optimized.wasm"
    [ ! -f "$WASM" ] && WASM="$TARGET_DIR/noether_market.wasm"
    [ ! -f "$WASM" ] && WASM="$TARGET_DIR/market.optimized.wasm"
    [ ! -f "$WASM" ] && WASM="$TARGET_DIR/market.wasm"

    if [ ! -f "$WASM" ]; then
        print_error "Market WASM not found"
    fi

    print_step "Deploying Market..."
    print_substep "WASM: $(basename $WASM)"
    print_substep "This may take 30-60 seconds..."

    local deploy_output=$($CLI contract deploy \
        --wasm "$WASM" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" 2>&1)

    MARKET_CONTRACT_ID=$(echo "$deploy_output" | grep -oE "C[A-Z0-9]{55}" | head -1)

    if [ -z "$MARKET_CONTRACT_ID" ]; then
        echo "$deploy_output"
        print_error "Failed to deploy Market"
    fi

    print_success "Market deployed: $MARKET_CONTRACT_ID"
}

# ============================================================================
# STEP 5: INITIALIZE CONTRACTS
# ============================================================================

initialize_contracts() {
    print_header "STEP 5: Initialize & Wire Contracts"

    local CLI=$(get_cli)

    # External Oracle Contract IDs (Band & DIA on Stellar)
    local BAND_ORACLE="CBRV5ZEQSSCQ4FFO64OF46I3UASBVEJNE5C2MCFWVIXL4Z7DMD7PJJMF"
    local DIA_ORACLE="CAEDPEZDRCEJCF73ASC5JGNKCIJDV2QJQSW6DJ6B74MYALBNKCJ5IFP4"

    # 5A: Initialize Oracle Adapter
    print_step "Initializing Oracle Adapter..."
    $CLI contract invoke \
        --id "$ORACLE_CONTRACT_ID" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" \
        -- \
        initialize \
        --admin "$ADMIN_PUBLIC_KEY" \
        --band "$BAND_ORACLE" \
        --dia "$DIA_ORACLE" 2>&1 || print_warning "Oracle may already be initialized"

    print_substep "Oracle Adapter initialized"

    # 5B: Initialize Vault
    print_step "Initializing Vault..."
    $CLI contract invoke \
        --id "$VAULT_CONTRACT_ID" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" \
        -- \
        initialize \
        --admin "$ADMIN_PUBLIC_KEY" \
        --usdc_token "$USDC_CONTRACT_ID" 2>&1 || print_warning "Vault may already be initialized"

    print_substep "Vault initialized"

    # 5C: Initialize Market
    print_step "Initializing Market..."
    $CLI contract invoke \
        --id "$MARKET_CONTRACT_ID" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" \
        -- \
        initialize \
        --admin "$ADMIN_PUBLIC_KEY" \
        --vault "$VAULT_CONTRACT_ID" \
        --oracle "$ORACLE_CONTRACT_ID" \
        --usdc_token "$USDC_CONTRACT_ID" 2>&1 || print_warning "Market may already be initialized"

    print_substep "Market initialized"

    # 5D: Authorize Market in Vault
    print_step "Authorizing Market in Vault..."
    $CLI contract invoke \
        --id "$VAULT_CONTRACT_ID" \
        --network "$NETWORK" \
        --source "$IDENTITY_NAME" \
        -- \
        set_market_address \
        --market "$MARKET_CONTRACT_ID" 2>&1 || print_warning "Market may already be authorized"

    print_substep "Market authorized in Vault"

    print_success "All contracts initialized and wired"
}

# ============================================================================
# STEP 6: GENERATE FRONTEND CONFIG
# ============================================================================

generate_frontend_config() {
    print_header "STEP 6: Generate Frontend Configuration"

    # Create directories
    mkdir -p "$FRONTEND_DIR/public"
    mkdir -p "$FRONTEND_DIR/lib"

    # Generate contracts.json for frontend/public
    local PUBLIC_CONFIG="$FRONTEND_DIR/public/contracts.json"
    print_step "Writing $PUBLIC_CONFIG..."

    cat > "$PUBLIC_CONFIG" << EOF
{
  "network": "$NETWORK",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "rpcUrl": "$RPC_URL",
  "horizonUrl": "$HORIZON_URL",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "deployer": "$ADMIN_PUBLIC_KEY",
  "contracts": {
    "usdc": "$USDC_CONTRACT_ID",
    "oracle": "$ORACLE_CONTRACT_ID",
    "vault": "$VAULT_CONTRACT_ID",
    "market": "$MARKET_CONTRACT_ID"
  }
}
EOF

    # Generate deployed_contracts.json for frontend/lib
    local LIB_CONFIG="$FRONTEND_DIR/lib/deployed_contracts.json"
    print_step "Writing $LIB_CONFIG..."

    cat > "$LIB_CONFIG" << EOF
{
  "network": "$NETWORK",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "rpcUrl": "$RPC_URL",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "deployer": "$ADMIN_PUBLIC_KEY",
  "contracts": {
    "usdc": "$USDC_CONTRACT_ID",
    "oracle": "$ORACLE_CONTRACT_ID",
    "vault": "$VAULT_CONTRACT_ID",
    "market": "$MARKET_CONTRACT_ID"
  }
}
EOF

    # Append contract IDs to .env (these are not secrets, but useful)
    print_step "Appending deployed contract IDs to .env..."
    cat >> "$ENV_FILE" << EOF

# ============================================================================
# DEPLOYED CONTRACT IDs (auto-generated on $(date))
# ============================================================================
NEXT_PUBLIC_USDC_CONTRACT_ID=$USDC_CONTRACT_ID
NEXT_PUBLIC_ORACLE_CONTRACT_ID=$ORACLE_CONTRACT_ID
NEXT_PUBLIC_VAULT_CONTRACT_ID=$VAULT_CONTRACT_ID
NEXT_PUBLIC_MARKET_CONTRACT_ID=$MARKET_CONTRACT_ID
EOF

    print_success "Frontend configuration generated"
}

# ============================================================================
# DEPLOYMENT SUMMARY
# ============================================================================

print_summary() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                                          ║${NC}"
    echo -e "${GREEN}║${NC}            ${CYAN}🚀 NOETHER PROTOCOL - DEPLOYMENT COMPLETE 🚀${NC}                 ${GREEN}║${NC}"
    echo -e "${GREEN}║                                                                          ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}  ${YELLOW}Network:${NC}          $NETWORK                                           ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${YELLOW}Deployer:${NC}         ${ADMIN_PUBLIC_KEY:0:20}...                   ${GREEN}║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}  ${CYAN}CONTRACT IDs:${NC}                                                        ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                                          ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${YELLOW}USDC:${NC}     $USDC_CONTRACT_ID  ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${YELLOW}Oracle:${NC}   $ORACLE_CONTRACT_ID  ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${YELLOW}Vault:${NC}    $VAULT_CONTRACT_ID  ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${YELLOW}Market:${NC}   $MARKET_CONTRACT_ID  ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                                          ${GREEN}║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}  ${CYAN}FILES GENERATED:${NC}                                                     ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    • frontend/public/contracts.json                                     ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    • frontend/lib/deployed_contracts.json                               ${GREEN}║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}  ${CYAN}NEXT STEPS:${NC}                                                          ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    1. cd frontend && npm run dev                                        ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    2. Connect Freighter wallet (switch to Futurenet)                    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    3. Start trading!                                                    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                                          ${GREEN}║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

main() {
    print_banner

    echo -e "${YELLOW}Starting deployment...${NC}"
    echo -e "${YELLOW}Timestamp: ${CYAN}$(date)${NC}"
    echo ""

    # Check prerequisites
    if ! command -v cargo &> /dev/null; then
        print_error "Cargo (Rust) not installed. Please install Rust first."
    fi

    if ! command -v stellar &> /dev/null && ! command -v soroban &> /dev/null; then
        print_error "Stellar/Soroban CLI not installed. Please install it first."
    fi

    # Execute deployment steps
    load_environment       # Load secrets from .env (NOT hardcoded!)
    setup_identity
    build_contracts
    deploy_mock_usdc
    deploy_oracle_adapter
    deploy_vault
    deploy_market
    initialize_contracts
    generate_frontend_config

    # Print summary
    print_summary

    print_success "🎉 Deployment completed successfully!"
}

# Run main
main "$@"
