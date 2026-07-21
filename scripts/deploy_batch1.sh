#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# Batch-1 FRESH stack deploy — the P0-mainnet-gates cutover ceremony.
#
#   ./scripts/deploy_batch1.sh staging|prod|mainnet
#
# mainnet mode adds guards (Circle-USDC check, no friendbot, real-XLM funding
# checks) and ends with the LOCKDOWN step: pause(1) dark + NOE issuer supply
# lock + the self-2-of-3 admin flip (see MULTISIG-CEREMONY.md).
#
# Deploys and wires the COMPLETE Batch-1 stack in dependency order:
#   NOE SAC → shim → vault+market (ABI-coupled, deploy together) → router
#   → vault_factory → referral → set_referral/set_fee_split → asset-risk
#   ladder ×14 → oracle-guard arming (per-env posture) → NOE pre-mint →
#   vault funding + insurance buffer seed → contracts manifest → checklist.
#
# PREREQUISITE: the fresh QUORUM-build Noeracle must already be deployed from
# the Noeracle repo (feat/l08-l09-quorum-ring, scripts/deploy_oracle_v0.sh)
# and its id placed in this script's env file as B1_NOERACLE_ID. This script
# never touches the Noeracle contract itself.
#
# State: reads/writes the git-ignored .env.batch1.<env> — every deployed id is
# persisted back (B1_*_ID) so a failed run RESUMES where it stopped instead of
# deploying duplicates. This script never edits .env / Vercel / Azure — it
# PRINTS the propagation checklist at the end (runbook:
# docs/plans/operator/BATCH1-DEPLOY.md).
#
# Non-interactive: DEPLOY_YES=1 skips the confirm prompt (funding amounts then
# come only from env vars; unset = skipped, never guessed).
# ═════════════════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WASM_DIR="$ROOT/contracts/target/wasm"

ENV_NAME="${1:-}"
if [[ "$ENV_NAME" != "staging" && "$ENV_NAME" != "prod" && "$ENV_NAME" != "mainnet" ]]; then
  echo "usage: $0 staging|prod|mainnet"; exit 1
fi
ENV_FILE="$ROOT/.env.batch1.$ENV_NAME"

# Network plumbing: staging/prod = testnet stacks; mainnet is the real thing
# (no friendbot — accounts are created/funded with real XLM; the ceremony
# ends dark: multisig handover + NOE issuer lock + pause).
if [[ "$ENV_NAME" == "mainnet" ]]; then
  NET="mainnet"
  HORIZON="https://horizon.stellar.org"
else
  NET="testnet"
  HORIZON="https://horizon-testnet.stellar.org"
fi

# ── First run: write a template env file and stop ────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<'TPL'
# Batch-1 deploy inputs (git-ignored). Fill the REQUIRED block, re-run.
# ── REQUIRED ────────────────────────────────────────────────────────────────
B1_ADMIN_SECRET_KEY=            # stack admin secret (staging: staging admin / prod: noether_admin)
B1_NOERACLE_ID=                 # FRESH quorum-build Noeracle id (deploy it first from the Noeracle repo)
B1_USDC_TOKEN_ID=CA63EPM4EEXUVUANF6FQUJEJ37RWRYIXCARWFXYUMPP7RLZWFNLTVNR4
# ── OPTIONAL (defaults applied when empty) ──────────────────────────────────
B1_PUBLISHER_HEX=8f8650ca5cb1bc7491b68e02f4d89e54da1f1996e161897b0eabadc28534e17a
B1_TREASURY_PK=                 # fee-split treasury; empty = the admin address
B1_VAULT_FUND_USDC=             # LP seed via vault.deposit, whole USDC (empty = prompt/skip)
B1_BUFFER_SEED_USDC=            # insurance seed via vault.seed_buffer (empty = prompt/skip)
# ── Oracle-guard arming (staging arms when set; prod stores disabled) ───────
B1_STORK_SIGNER_EVM=            # 20-byte hex EVM addr of the Stork Fast signer
B1_STORK_TAXONOMY=              # Stork taxonomy id (u32)
B1_STORK_ASSET_IDS=             # e.g. [0,1]      (parallel with B1_STORK_TAGS)
B1_STORK_TAGS=                  # COMMA list, e.g. 4254435553440000,4554485553440000 (hex 8-byte tags, NO quotes/brackets)
B1_REFLECTOR_ORACLE_ID=         # SEP-40 vendor (Reflector) contract id
B1_REFLECTOR_DECIMALS=14
# ── Mainnet only (self-2-of-3: K1 = B1_ADMIN_SECRET_KEY above) ──────────────
B1_MULTISIG_K2_PK=              # phone-wallet signer PUBLIC key (G…)
B1_MULTISIG_K3_PK=              # paper-backup signer PUBLIC key (G…)
B1_RPC_URL=                     # paid mainnet RPC for the ceremony (empty = public)
TPL
  echo -e "${YELLOW}Wrote template $ENV_FILE — fill the REQUIRED block and re-run.${NC}"
  exit 1
fi

set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a

: "${B1_ADMIN_SECRET_KEY:?B1_ADMIN_SECRET_KEY missing in $ENV_FILE}"
: "${B1_NOERACLE_ID:?B1_NOERACLE_ID missing in $ENV_FILE (deploy the quorum Noeracle first)}"
: "${B1_USDC_TOKEN_ID:?B1_USDC_TOKEN_ID missing in $ENV_FILE}"
B1_PUBLISHER_HEX="${B1_PUBLISHER_HEX:-8f8650ca5cb1bc7491b68e02f4d89e54da1f1996e161897b0eabadc28534e17a}"

CLI="$(command -v stellar || command -v soroban)"
IDENTITY="batch1_${ENV_NAME}_admin"
SOROBAN_SECRET_KEY="$B1_ADMIN_SECRET_KEY" $CLI keys add "$IDENTITY" --secret-key >/dev/null 2>&1 || true
ADMIN_PK="$($CLI keys address "$IDENTITY")"
TREASURY_PK="${B1_TREASURY_PK:-$ADMIN_PK}"

save_var() { # save_var KEY VALUE — persist into the env file (resume support)
  local k="$1" v="$2"
  if grep -q "^$k=" "$ENV_FILE"; then
    local tmp; tmp="$(mktemp)"; sed "s|^$k=.*|$k=$v|" "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
  fi
}

invoke() { # invoke LABEL -- <cli args…>: fatal on error, prints the label
  local label="$1"; shift
  local out
  if ! out="$("$CLI" contract invoke "$@" 2>&1)"; then
    echo -e "${RED}  ✗ $label FAILED:${NC}"; echo "$out" | tail -5; exit 1
  fi
  echo "  ✓ $label"
}

init_contract() { # init_contract LABEL -- <invoke args…>
  # AlreadyInitialized is #2 in NoetherError (market/shim/router) but #1 in
  # the vault/factory/referral enums — in an init context both codes only
  # ever mean "already initialized", so both make a re-run idempotent.
  local label="$1"; shift
  local out
  if out="$("$CLI" contract invoke "$@" 2>&1)"; then
    echo "  ✓ $label initialized"
  elif echo "$out" | grep -qE "Error\(Contract, #(1|2)\)"; then
    echo "  • $label already initialized"
  else
    echo -e "${RED}  ✗ $label init FAILED:${NC}"; echo "$out" | tail -5; exit 1
  fi
}

echo -e "${CYAN}══ Batch-1 deploy ($ENV_NAME) ══${NC}"
echo "  Admin    : $ADMIN_PK"
echo "  Treasury : $TREASURY_PK"
echo "  Noeracle : $B1_NOERACLE_ID (quorum build, pre-deployed)"
echo "  USDC     : $B1_USDC_TOKEN_ID"
echo "  Publisher: $B1_PUBLISHER_HEX"
echo -e "  Arming   : $([[ "$ENV_NAME" == "staging" ]] && echo 'STAGING — Stork/Reflector armed when configured, BTC+ETH strict' || echo 'PROD — guards stored disabled (fail-open); arm after soak')"
echo ""
if [[ "${DEPLOY_YES:-}" != "1" ]]; then
  read -r -p "Deploy the FRESH $ENV_NAME Batch-1 stack? [y/N] " ok
  [[ "$ok" == "y" || "$ok" == "Y" ]] || exit 1
fi

# ── Mainnet guards ──────────────────────────────────────────────────────────
if [[ "$ENV_NAME" == "mainnet" ]]; then
  # Ensure the CLI knows the network (idempotent; B1_RPC_URL from the env
  # file — a paid endpoint if set, the public one otherwise).
  stellar network add mainnet \
    --rpc-url "${B1_RPC_URL:-https://mainnet.sorobanrpc.com}" \
    --network-passphrase 'Public Global Stellar Network ; September 2015' >/dev/null 2>&1 || true
  if [[ "$B1_USDC_TOKEN_ID" == "CA63EPM4EEXUVUANF6FQUJEJ37RWRYIXCARWFXYUMPP7RLZWFNLTVNR4" ]]; then
    echo -e "${RED}B1_USDC_TOKEN_ID is the TESTNET USDC. Mainnet must use Circle's issued"
    echo -e "USDC SAC — derive it with:"
    echo -e "  stellar contract asset id --asset USDC:<circle issuer> --network mainnet"
    echo -e "and verify the issuer against circle.com/usdc docs before proceeding.${NC}"
    exit 1
  fi
  : "${B1_MULTISIG_K2_PK:?mainnet needs B1_MULTISIG_K2_PK (phone-wallet signer public key)}"
  : "${B1_MULTISIG_K3_PK:?mainnet needs B1_MULTISIG_K3_PK (paper-backup signer public key)}"
fi

# ── 0. Funded admin + fresh optimized WASM ──────────────────────────────────
if ! curl -s "$HORIZON/accounts/$ADMIN_PK" | grep -q '"account_id"'; then
  if [[ "$ENV_NAME" == "mainnet" ]]; then
    echo -e "${RED}Admin $ADMIN_PK does not exist on mainnet — fund it with real XLM"
    echo -e "(~100 XLM recommended for the full ceremony) and re-run.${NC}"
  else
    echo -e "${RED}Admin $ADMIN_PK unfunded. Fund: curl 'https://friendbot.stellar.org/?addr=$ADMIN_PK'${NC}"
  fi
  exit 1
fi
echo -e "${YELLOW}[0/9] Building + optimizing contracts…${NC}"
"$SCRIPT_DIR/build_contracts.sh" >/dev/null
for w in noeracle_shim vault market noether_router vault_factory referral; do
  [[ -f "$WASM_DIR/$w.wasm" ]] || { echo -e "${RED}missing $WASM_DIR/$w.wasm${NC}"; exit 1; }
done
echo -e "${GREEN}✓ WASM ready${NC}"; echo ""

# ── 1. Fresh NOE SAC with a FRESH ISSUER keypair ────────────────────────────
# A SAC's contract id is DETERMINISTIC in (code, issuer): reusing the admin
# as issuer resolves to the OLD stack's NOE, and stale LP shares from the
# previous vault could then withdraw against the fresh one. A throwaway
# issuer per ceremony makes the asset genuinely new (persisted for resume).
NOE_IDENT="batch1_${ENV_NAME}_noe_issuer"
if [[ -z "${B1_NOE_ISSUER_SECRET:-}" ]]; then
  echo -e "${YELLOW}[1/9] Generating fresh NOE issuer keypair…${NC}"
  $CLI keys generate "$NOE_IDENT" --network "$NET" --fund >/dev/null 2>&1 || true
  B1_NOE_ISSUER_SECRET="$($CLI keys show "$NOE_IDENT")"
  save_var B1_NOE_ISSUER_SECRET "$B1_NOE_ISSUER_SECRET"
else
  SOROBAN_SECRET_KEY="$B1_NOE_ISSUER_SECRET" $CLI keys add "$NOE_IDENT" --secret-key >/dev/null 2>&1 || true
fi
NOE_ISSUER_PK="$($CLI keys address "$NOE_IDENT")"
if [[ "$ENV_NAME" == "mainnet" ]]; then
  # No friendbot on mainnet: create+fund the issuer from the admin (3 XLM
  # covers the base reserve + the lock tx; idempotent — exists = skip).
  if ! curl -s "$HORIZON/accounts/$NOE_ISSUER_PK" | grep -q '"account_id"'; then
    "$CLI" tx new create-account --source-account "$IDENTITY" \
      --destination "$NOE_ISSUER_PK" --starting-balance 30000000 --network "$NET" >/dev/null
  fi
else
  curl -s "https://friendbot.stellar.org/?addr=$NOE_ISSUER_PK" >/dev/null 2>&1 || true
fi
if [[ -z "${B1_NOE_TOKEN_ID:-}" ]]; then
  B1_NOE_TOKEN_ID="$($CLI contract asset deploy --asset "NOE:$NOE_ISSUER_PK" --source "$NOE_IDENT" --network "$NET")"
  save_var B1_NOE_TOKEN_ID "$B1_NOE_TOKEN_ID"
fi
echo -e "${GREEN}  NOE: $B1_NOE_TOKEN_ID (issuer $NOE_ISSUER_PK)${NC}"; echo ""

# ── 2. Deploy the six contracts (resumable) ─────────────────────────────────
deploy_wasm() { # deploy_wasm VARNAME wasm_name
  local var="$1" wasm="$2"
  if [[ -z "${!var:-}" ]]; then
    local id; id="$($CLI contract deploy --wasm "$WASM_DIR/$wasm" --source "$IDENTITY" --network "$NET" 2>/dev/null | tail -1)"
    save_var "$var" "$id"; printf '%s' "$id"
  else printf '%s' "${!var}"; fi
}
echo -e "${YELLOW}[2/9] Deploying shim, vault, market, router, factory, referral…${NC}"
B1_SHIM_ID="$(deploy_wasm B1_SHIM_ID noeracle_shim.wasm)";        echo "  shim    : $B1_SHIM_ID"
B1_VAULT_ID="$(deploy_wasm B1_VAULT_ID vault.wasm)";              echo "  vault   : $B1_VAULT_ID"
B1_MARKET_ID="$(deploy_wasm B1_MARKET_ID market.wasm)";           echo "  market  : $B1_MARKET_ID"
B1_ROUTER_ID="$(deploy_wasm B1_ROUTER_ID noether_router.wasm)";   echo "  router  : $B1_ROUTER_ID"
B1_FACTORY_ID="$(deploy_wasm B1_FACTORY_ID vault_factory.wasm)";  echo "  factory : $B1_FACTORY_ID"
B1_REFERRAL_ID="$(deploy_wasm B1_REFERRAL_ID referral.wasm)";     echo "  referral: $B1_REFERRAL_ID"
echo ""

# ── 3. Initialize in dependency order ───────────────────────────────────────
echo -e "${YELLOW}[3/9] Initializing…${NC}"

init_contract "shim → quorum Noeracle" --id "$B1_SHIM_ID" --source "$IDENTITY" --network "$NET" -- \
  initialize --admin "$ADMIN_PK" --noeracle_oracle "$B1_NOERACLE_ID"

init_contract "vault" --id "$B1_VAULT_ID" --source "$IDENTITY" --network "$NET" -- initialize \
  --admin "$ADMIN_PK" --usdc_token "$B1_USDC_TOKEN_ID" --noe_token "$B1_NOE_TOKEN_ID" \
  --market_contract "$B1_MARKET_ID" --deposit_fee_bps 30 --withdraw_fee_bps 30

# FULL Batch-1 MarketConfig — every field of the coordinated shape, at the
# code defaults (types.rs Default). i128 fields MUST be strings for the CLI.
MKTCFG="$(mktemp)"
cat > "$MKTCFG" <<'JSON'
{"min_collateral":"100000000","max_leverage":10,"maintenance_margin_bps":100,
 "liquidation_fee_bps":500,"trading_fee_bps":10,"base_funding_rate_bps":1,
 "max_position_size":"1000000000000","max_price_staleness":60,
 "max_oracle_deviation_bps":100,"twap_records":4,"twap_max_age_secs":300,
 "base_maker_fee_bps":2,"base_taker_fee_bps":5,
 "partial_liq_min_notional":"10000000000","partial_liq_tranche_bps":2000,
 "partial_liq_cooldown_secs":30,"insurance_buffer_share_bps":1000,
 "liquidation_penalty_bps":100,"penalty_keeper_share_bps":5000,
 "cross_liq_restore_target_bps":15000,"cross_close_out_bps":6667,
 "adl_trigger_ratio_bps":12500,"adl_clear_ratio_bps":15000,
 "adl_compensation_bps":0,"min_liq_bounty":"50000000",
 "lenient_clamp_bps":300,"keeper_fee_base":"0","keeper_fee_deci_bps":10}
JSON
init_contract "market (oracle → shim)" --id "$B1_MARKET_ID" --source "$IDENTITY" --network "$NET" -- \
  initialize --admin "$ADMIN_PK" --oracle_adapter "$B1_SHIM_ID" --vault "$B1_VAULT_ID" \
  --usdc_token "$B1_USDC_TOKEN_ID" --config-file-path "$MKTCFG"
rm -f "$MKTCFG"

init_contract "router" --id "$B1_ROUTER_ID" --source "$IDENTITY" --network "$NET" -- initialize \
  --admin "$ADMIN_PK" --market "$B1_MARKET_ID" --noeracle "$B1_NOERACLE_ID" \
  --publishers "[\"$B1_PUBLISHER_HEX\"]"

init_contract "vault_factory" --id "$B1_FACTORY_ID" --source "$IDENTITY" --network "$NET" -- \
  initialize --admin "$ADMIN_PK" --market "$B1_MARKET_ID" --usdc "$B1_USDC_TOKEN_ID"

init_contract "referral" --id "$B1_REFERRAL_ID" --source "$IDENTITY" --network "$NET" -- \
  initialize --admin "$ADMIN_PK" --market "$B1_MARKET_ID" --usdc_token "$B1_USDC_TOKEN_ID"
echo ""

# ── 4. Wire referral economics (L1-18 deploy-day ordering) ──────────────────
echo -e "${YELLOW}[4/9] Wiring referral economics…${NC}"
invoke "market.set_referral" --id "$B1_MARKET_ID" --source "$IDENTITY" --network "$NET" -- \
  set_referral --referral "$B1_REFERRAL_ID"
invoke "market.set_fee_split(treasury, 2000)" --id "$B1_MARKET_ID" --source "$IDENTITY" --network "$NET" -- \
  set_fee_split --treasury "$TREASURY_PK" --bps 2000
REFCFG="$($CLI contract invoke --id "$B1_REFERRAL_ID" --source "$IDENTITY" --network "$NET" -- get_config 2>/dev/null | tail -1)"
if echo "$REFCFG" | grep -q "400" && echo "$REFCFG" | grep -q "1000"; then
  echo "  ✓ referral get_config sane: $REFCFG"
else
  echo -e "${RED}  ✗ referral get_config unexpected: $REFCFG (want discount 400 / share 1000)${NC}"; exit 1
fi
echo ""

# ── 5. Per-asset risk ladder ×14 (L0-12) ────────────────────────────────────
# NOTE: the ladder floor is im 400 / mm 200 (mm == im/2, im >= 400 enforced
# on-chain) — maintenance margin moves 1% → 2% versus the legacy global. That
# tightening is the L0-12 policy, not an accident. Uniform seed; tune per
# asset later with single set_asset_risk calls.
echo -e "${YELLOW}[5/9] Seeding asset-risk ladder (uniform: 10x, im 400, mm 200)…${NC}"
RISK="$(mktemp)"
cat > "$RISK" <<'JSON'
{"max_leverage":10,"im_bps":400,"mm_bps":200,"close_out_bps":133,
 "max_position_size":"1000000000000","max_funding_velocity_bps":3600,
 "funding_clamp_bps":100,"skew_scale":"2000000000000"}
JSON
for sym in BTC ETH XLM SOL XRP ADA BNB TRX HYPE DOGE ZEC LINK BCH LTC; do
  invoke "set_asset_risk $sym" --id "$B1_MARKET_ID" --source "$IDENTITY" --network "$NET" -- \
    set_asset_risk --asset "$sym" --params-file-path "$RISK"
done
rm -f "$RISK"
echo ""

# ── 6. Oracle-guard arming (founder decision: staging armed, prod fail-open) ─
echo -e "${YELLOW}[6/9] Oracle guards…${NC}"
STORK_ENABLED=false; [[ "$ENV_NAME" == "staging" ]] && STORK_ENABLED=true
if [[ -n "${B1_STORK_SIGNER_EVM:-}" && -n "${B1_STORK_TAXONOMY:-}" ]]; then
  STORKCFG="$(mktemp)"
  cat > "$STORKCFG" <<JSON
{"enabled":$STORK_ENABLED,"require_fresh":false,"signer":"$B1_STORK_SIGNER_EVM",
 "taxonomy":$B1_STORK_TAXONOMY,"max_age_secs":60,"max_dev_bps":100}
JSON
  invoke "router.set_stork_config (enabled=$STORK_ENABLED)" --id "$B1_ROUTER_ID" --source "$IDENTITY" --network "$NET" -- \
    set_stork_config --config-file-path "$STORKCFG"
  rm -f "$STORKCFG"
  if [[ -n "${B1_STORK_ASSET_IDS:-}" && -n "${B1_STORK_TAGS:-}" ]]; then
    # B1_STORK_TAGS is a COMMA list of 8-byte hex tags (no brackets/quotes —
    # `source` would strip them); build the JSON array in a file for the CLI.
    TAGSF="$(mktemp)"
    printf '[' > "$TAGSF"
    first=1
    IFS=',' read -ra TAGARR <<< "$B1_STORK_TAGS"
    for t in "${TAGARR[@]}"; do
      [[ $first == 1 ]] || printf ',' >> "$TAGSF"
      first=0
      printf '"%s"' "$t" >> "$TAGSF"
    done
    printf ']' >> "$TAGSF"
    invoke "router.set_stork_assets" --id "$B1_ROUTER_ID" --source "$IDENTITY" --network "$NET" -- \
      set_stork_assets --ids "$B1_STORK_ASSET_IDS" --tags-file-path "$TAGSF"
    rm -f "$TAGSF"
  fi
else
  echo "  • Stork config vars unset — guard stays unconfigured (fail-open)"
fi
if [[ "$ENV_NAME" == "staging" ]]; then
  invoke "router.set_stork_strict_assets [BTC, ETH]" --id "$B1_ROUTER_ID" --source "$IDENTITY" --network "$NET" -- \
    set_stork_strict_assets --assets '["BTC","ETH"]'
else
  echo "  • prod: strict-assets list left empty (arm after soak)"
fi
if [[ -n "${B1_REFLECTOR_ORACLE_ID:-}" ]]; then
  REFL_ENABLED=false; [[ "$ENV_NAME" == "staging" ]] && REFL_ENABLED=true
  REFLCFG="$(mktemp)"
  cat > "$REFLCFG" <<JSON
{"enabled":$REFL_ENABLED,"oracle":"$B1_REFLECTOR_ORACLE_ID",
 "decimals":${B1_REFLECTOR_DECIMALS:-14},"max_age_secs":300,"max_dev_bps":100}
JSON
  invoke "router.set_reflector_config (enabled=$REFL_ENABLED)" --id "$B1_ROUTER_ID" --source "$IDENTITY" --network "$NET" -- \
    set_reflector_config --config-file-path "$REFLCFG"
  rm -f "$REFLCFG"
else
  echo "  • Reflector id unset — third source stays unconfigured (fail-open)"
fi
echo ""

# ── 7. NOE pre-mint to the vault (SAC mint auth = the ISSUER) ───────────────
if [[ -z "${B1_NOE_PREMINTED:-}" ]]; then
  echo -e "${YELLOW}[7/9] Pre-minting 1,000,000,000 NOE to the vault…${NC}"
  invoke "NOE mint → vault" --id "$B1_NOE_TOKEN_ID" --source "$NOE_IDENT" --network "$NET" -- \
    mint --to "$B1_VAULT_ID" --amount 10000000000000000
  save_var B1_NOE_PREMINTED yes
else
  echo -e "${GREEN}[7/9] NOE already pre-minted${NC}"
fi
echo ""

# ── 8. Vault LP funding + insurance buffer seed (deposit, NEVER transfer) ───
echo -e "${YELLOW}[8/9] Vault funding…${NC}"
FUND="${B1_VAULT_FUND_USDC:-}"
if [[ -z "$FUND" && "${DEPLOY_YES:-}" != "1" ]]; then
  read -r -p "  LP-seed the vault via deposit? Whole USDC (empty = skip): " FUND
fi
if [[ -n "$FUND" && "$FUND" != "0" ]]; then
  # The depositor receives NOE shares → needs a classic trustline to the
  # fresh NOE asset first (idempotent).
  "$CLI" tx new change-trust --source-account "$IDENTITY" --line "NOE:$NOE_ISSUER_PK" \
    --network "$NET" >/dev/null 2>&1 || true
  invoke "vault.deposit $FUND USDC (admin LP seed)" --id "$B1_VAULT_ID" --source "$IDENTITY" --network "$NET" -- \
    deposit --depositor "$ADMIN_PK" --usdc_amount "${FUND}0000000"
else
  echo "  • LP seed skipped"
fi
SEED="${B1_BUFFER_SEED_USDC:-}"
if [[ -z "$SEED" && "${DEPLOY_YES:-}" != "1" ]]; then
  read -r -p "  Seed the insurance buffer? Whole USDC (empty = skip): " SEED
fi
if [[ -n "$SEED" && "$SEED" != "0" ]]; then
  invoke "vault.seed_buffer $SEED USDC" --id "$B1_VAULT_ID" --source "$IDENTITY" --network "$NET" -- \
    seed_buffer --from "$ADMIN_PK" --amount "${SEED}0000000"
else
  echo "  • buffer seed skipped"
fi
echo ""

# ── 9. Contracts manifest + verify + checklist ──────────────────────────────
MANIFEST="$ROOT/contracts.json"
[[ "$ENV_NAME" == "staging" ]] && MANIFEST="$ROOT/contracts.staging.json"
[[ "$ENV_NAME" == "mainnet" ]] && MANIFEST="$ROOT/contracts.mainnet.json"
echo -e "${YELLOW}[9/9] Writing $(basename "$MANIFEST")…${NC}"
cat > "$MANIFEST" <<JSON
{
  "network": "$NET",
  "env": "$ENV_NAME",
  "deployedAt": "$(date -u '+%Y-%m-%d %H:%M:%S')",
  "contracts": {
    "market": "$B1_MARKET_ID",
    "vault": "$B1_VAULT_ID",
    "noeToken": "$B1_NOE_TOKEN_ID",
    "noetherRouter": "$B1_ROUTER_ID",
    "noeracleShim": "$B1_SHIM_ID",
    "noeracle": "$B1_NOERACLE_ID",
    "usdcToken": "$B1_USDC_TOKEN_ID",
    "vaultFactory": "$B1_FACTORY_ID",
    "referral": "$B1_REFERRAL_ID"
  },
  "admin": "$ADMIN_PK",
  "noeAsset": { "code": "NOE", "issuer": "$NOE_ISSUER_PK" }
}
JSON
echo "  ✓ manifest written"

# Cheap read-back verification (fatal on mismatch).
GOT_MARKET="$($CLI contract invoke --id "$B1_ROUTER_ID" --source "$IDENTITY" --network "$NET" -- get_market 2>/dev/null | tail -1 | tr -d '"')"
[[ "$GOT_MARKET" == "$B1_MARKET_ID" ]] || { echo -e "${RED}router.get_market mismatch: $GOT_MARKET${NC}"; exit 1; }
GOT_VER="$($CLI contract invoke --id "$B1_REFERRAL_ID" --source "$IDENTITY" --network "$NET" -- version 2>/dev/null | tail -1)"
echo "$GOT_VER" | grep -q referral_v1 || { echo -e "${RED}referral.version != referral_v1: $GOT_VER${NC}"; exit 1; }
echo -e "${GREEN}  ✓ router→market wired, referral_v1 confirmed${NC}"
echo ""

# ── 10. Mainnet lockdown: dark pause → NOE supply lock → 2-of-3 flip ────────
if [[ "$ENV_NAME" == "mainnet" ]]; then
  echo -e "${YELLOW}[10] Mainnet lockdown…${NC}"

  # (a) DARK: halt-open pause. Opens/deposits blocked (#4); closes, cancels
  #     and liquidations stay possible by design. Unpause happens after the
  #     audit clears — and will then need TWO signatures.
  invoke "market.pause(1) — stack goes DARK" --id "$B1_MARKET_ID" --source "$IDENTITY" --network "$NET" -- \
    pause --mode 1

  # (b) NOE supply lock: an unlocked LP-share issuer is a vault-drain key
  #     (mint shares → withdraw real USDC). Master weight 0 fixes the
  #     supply at the 1B pre-mint FOREVER. IRREVERSIBLE by construction.
  if [[ -z "${B1_NOE_LOCKED:-}" ]]; then
    "$CLI" tx new set-options --source-account "$NOE_IDENT" --master-weight 0 --network "$NET" >/dev/null
    save_var B1_NOE_LOCKED yes
    echo "  ✓ NOE issuer LOCKED — supply fixed forever"
  else
    echo "  • NOE issuer already locked"
  fi

  # (c) Self-2-of-3: add K2 (phone) and K3 (paper), raising every threshold
  #     to 2 IN THE SAME TX as the last signer — there is never a moment
  #     where the account is locked out or single-key with raised bars.
  #     From here on, EVERY admin op needs two of {K1 laptop, K2 phone,
  #     K3 paper} — see scripts/sign2.sh and MULTISIG-CEREMONY.md.
  if [[ -z "${B1_MULTISIG_DONE:-}" ]]; then
    "$CLI" tx new set-options --source-account "$IDENTITY" --network "$NET" \
      --signer "$B1_MULTISIG_K2_PK" --signer-weight 1 >/dev/null
    "$CLI" tx new set-options --source-account "$IDENTITY" --network "$NET" \
      --signer "$B1_MULTISIG_K3_PK" --signer-weight 1 \
      --master-weight 1 --low-threshold 2 --med-threshold 2 --high-threshold 2 >/dev/null
    save_var B1_MULTISIG_DONE yes
    echo "  ✓ Admin is now 2-of-3 — K1 alone can no longer act"
  else
    echo "  • 2-of-3 already configured"
  fi
  echo ""
fi

echo -e "${CYAN}══ DONE — manual propagation checklist (nothing below is automated) ══${NC}"
cat <<EOF
  1. Keeper ($ENV_NAME): az containerapp update -n $([[ "$ENV_NAME" == "staging" ]] && echo noether-keeper-staging || echo noether-keeper) -g noether-rg --set-env-vars \\
       NEXT_PUBLIC_MARKET_ID=$B1_MARKET_ID NEXT_PUBLIC_VAULT_ID=$B1_VAULT_ID \\
       NEXT_PUBLIC_NOERACLE_ID=$B1_NOERACLE_ID NEXT_PUBLIC_NOERACLE_SHIM_ID=$B1_SHIM_ID \\
       NEXT_PUBLIC_NOETHER_ROUTER_ID=$B1_ROUTER_ID NEXT_PUBLIC_VAULT_FACTORY_ID=$B1_FACTORY_ID
  2. api + indexer: az containerapp update -n noether-api / noether-indexer with the matching
     CONTRACT_* / NEXT_PUBLIC_* overrides, then: npm -w @noether/indexer run migrate
  3. Web: update web/.env.azure.$ENV_NAME.local with the ids above, then
     ./scripts/deploy_web_azure.sh $ENV_NAME   (NEXT_PUBLIC_* are BUILD-time)
  4. .env (local dev): update the NEXT_PUBLIC_* ids by hand.
  5. Keeper wallet: ensure a USDC trustline + the NOE-issuer trustline gotcha
     (see project memory: OI-cap #82) before first liquidation.
  6. Re-faucet testers (fresh stack = fresh positions; USDC unchanged).
  7. Smoke per docs/plans/operator/BATCH1-DEPLOY.md §Verify.
EOF
