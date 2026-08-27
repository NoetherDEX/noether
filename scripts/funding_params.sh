#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Funding parameter ladder — print (or apply) set_asset_risk for every pair with
# only the two funding fields changed; everything else is read live from
# get_asset_risk so the ladder (im/mm/close-out/max size/skew scale) is untouched.
#
# Usage:
#   scripts/funding_params.sh <market-id> <source-identity> [clamp_bps_per_hour] [velocity_bps_per_day] [--apply]
#
# Defaults: clamp 5 (0.05 %/h), velocity 120 (≈5 bps/h of rate change at full
# skew). Without --apply the invoke lines are printed for the operator to run
# (prod ceremony); with --apply they are executed in order.
#
# Background: contracts ran with clamp 100 (1 %/h) + velocity 3600 — see
# docs/superpowers/specs/2026-08-27-funding-counterparty-fix-design.md.
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

MARKET="${1:?market contract id}"
SOURCE="${2:?source identity (market admin)}"
CLAMP="${3:-5}"
VEL="${4:-120}"
APPLY=0
for a in "$@"; do [ "$a" = "--apply" ] && APPLY=1; done
NETWORK="${NETWORK:-testnet}"

PAIRS=(BTC ETH XLM SOL XRP ADA BNB TRX HYPE DOGE ZEC LINK BCH LTC)

for sym in "${PAIRS[@]}"; do
  cur=$(stellar contract invoke --id "$MARKET" --network "$NETWORK" --source "$SOURCE" -- get_asset_risk --asset "$sym" 2>/dev/null || true)
  if [ -z "$cur" ] || [ "$cur" = "null" ]; then
    echo "# $sym: unconfigured on $MARKET — skipped"
    continue
  fi
  new=$(python3 -c '
import json, sys
d = json.loads(sys.argv[1])
d["funding_clamp_bps"] = int(sys.argv[2])
d["max_funding_velocity_bps"] = int(sys.argv[3])
print(json.dumps(d, separators=(",", ":")))
' "$cur" "$CLAMP" "$VEL")
  cmd=(stellar contract invoke --id "$MARKET" --network "$NETWORK" --source "$SOURCE" -- set_asset_risk --asset "$sym" --params "$new")
  if [ "$APPLY" = "1" ]; then
    echo "→ $sym: clamp=$CLAMP velocity=$VEL"
    "${cmd[@]}" >/dev/null
  else
    printf '%q ' "${cmd[@]}"; echo
  fi
done
