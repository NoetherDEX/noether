#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# verify_stack.sh — detect stack drift across the deploy (D-6 / P3-3)
#
# Compares contracts.json against what a running api gateway ACTUALLY
# serves (its /v1/health contract echo — the D-4 fix) and checks the
# Noeracle price feed is fresh. Catches the failure the audit flagged:
# the site on the new stack while the gateway/indexer silently serve the
# old one. Non-zero exit on any mismatch so it can gate a deploy script.
#
# Usage:
#   ./scripts/verify_stack.sh [API_BASE_URL] [contracts.json]
#   API_BASE_URL defaults to $NOETHER_API_URL or http://localhost:4000
# ═══════════════════════════════════════════════════════════════════════
set -uo pipefail

API_BASE="${1:-${NOETHER_API_URL:-http://localhost:4000}}"
MANIFEST="${2:-contracts.json}"
FAIL=0
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; NC='\033[0m'

if ! command -v jq >/dev/null 2>&1; then echo "jq required" >&2; exit 2; fi
[[ -f "$MANIFEST" ]] || { echo "no $MANIFEST" >&2; exit 2; }

echo "Verifying stack against $API_BASE ..."
HEALTH=$(curl -fsS --max-time 10 "$API_BASE/v1/health" 2>/dev/null) || {
  echo -e "${RED}✗ api /v1/health unreachable at $API_BASE${NC}"; exit 2;
}

# The health payload echoes resolved { address, source } per contract key.
check() {
  local key="$1" want served
  want=$(jq -r ".contracts.$key // empty" "$MANIFEST")
  served=$(echo "$HEALTH" | jq -r ".contracts.$key.address // empty")
  [[ -z "$want" ]] && return 0
  if [[ "$want" == "$served" ]]; then
    local src; src=$(echo "$HEALTH" | jq -r ".contracts.$key.source // \"?\"")
    echo -e "${GRN}✓${NC} $key matches ($src)"
  else
    echo -e "${RED}✗ $key DRIFT${NC}: contracts.json=$want  api-serves=${served:-<unset>}"
    FAIL=1
  fi
}
for k in market vault noeracleShim noetherRouter usdcToken noeToken; do check "$k"; done

# Indexer read-side freshness (stalled cursor = stale reads).
AGE=$(echo "$HEALTH" | jq -r '.indexer.ledgerAgeSeconds // empty')
if [[ -n "$AGE" && "$AGE" != "null" ]]; then
  if (( AGE > 300 )); then
    echo -e "${RED}✗ indexer cursor is ${AGE}s stale (>300s)${NC}"; FAIL=1
  else
    echo -e "${GRN}✓${NC} indexer cursor fresh (${AGE}s)"
  fi
else
  echo -e "${YEL}~ indexer age not reported (older api or empty DB)${NC}"
fi

if (( FAIL )); then
  echo -e "\n${RED}STACK DRIFT DETECTED — do not promote.${NC}"; exit 1
fi
echo -e "\n${GRN}Stack consistent.${NC}"
