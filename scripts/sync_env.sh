#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# sync_env.sh — render env blocks from contracts.json (D-6 / TASKS.md P3-3)
#
# Single source of truth for the 5-system address propagation. Emits the
# NEXT_PUBLIC_* block for Vercel/.env, the CONTRACT_* override block for
# Railway (api + indexer — the overrides that dodge the Docker-baked
# manifest, D-4), and ready-to-paste `railway`/`vercel` CLI commands.
#
# Read-only: prints to stdout, never writes .env or calls any dashboard.
#
# Usage:
#   ./scripts/sync_env.sh [path/to/contracts.json]   # default: ./contracts.json
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

MANIFEST="${1:-contracts.json}"
if [[ ! -f "$MANIFEST" ]]; then
  echo "contracts.json not found at: $MANIFEST" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (brew install jq)" >&2
  exit 1
fi

get() { jq -r ".contracts.$1 // empty" "$MANIFEST"; }

MARKET=$(get market)
VAULT=$(get vault)
SHIM=$(get noeracleShim)
ROUTER=$(get noetherRouter)
VFACTORY=$(get vaultFactory)
REFERRAL=$(get referral)
USDC=$(get usdcToken)
NOE=$(get noeToken)
NETWORK=$(jq -r '.network // "testnet"' "$MANIFEST")
DEPLOYED=$(jq -r '.deployedAt // "unknown"' "$MANIFEST")

echo "# ─────────────────────────────────────────────────────────────────"
echo "# Rendered from $MANIFEST (network: $NETWORK, deployed: $DEPLOYED)"
echo "# ─────────────────────────────────────────────────────────────────"
echo
echo "# ── Frontend (Vercel / web .env) — NEXT_PUBLIC_* ──"
echo "NEXT_PUBLIC_MARKET_ID=$MARKET"
echo "NEXT_PUBLIC_VAULT_ID=$VAULT"
echo "NEXT_PUBLIC_NOERACLE_SHIM_ID=$SHIM"
echo "NEXT_PUBLIC_NOETHER_ROUTER_ID=$ROUTER"
echo "NEXT_PUBLIC_VAULT_FACTORY_ID=$VFACTORY"
echo "NEXT_PUBLIC_REFERRAL_ID=$REFERRAL"
echo "NEXT_PUBLIC_USDC_TOKEN_ID=$USDC"
echo "NEXT_PUBLIC_NOE_TOKEN_ID=$NOE"
echo
echo "# ── Railway api + indexer — CONTRACT_* overrides (win over baked manifest, D-4) ──"
echo "CONTRACT_MARKET=$MARKET"
echo "CONTRACT_VAULT=$VAULT"
echo "CONTRACT_NOERACLE_SHIM=$SHIM"
echo "CONTRACT_NOETHER_ROUTER=$ROUTER"
[[ -n "$VFACTORY" ]] && echo "CONTRACT_VAULT_FACTORY=$VFACTORY"
[[ -n "$REFERRAL" ]] && echo "CONTRACT_REFERRAL=$REFERRAL"
echo
echo "# ── Copy-paste: Railway CLI (run per service: api, indexer) ──"
echo "railway variables --set CONTRACT_MARKET=$MARKET --set CONTRACT_VAULT=$VAULT \\"
echo "  --set CONTRACT_NOERACLE_SHIM=$SHIM --set CONTRACT_NOETHER_ROUTER=$ROUTER"
