#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# check_mainnet_parity.sh — testnet→mainnet config-parity gate (P6-3, critic #5)
#
# Every demo/testnet constant that MUST flip before a real-value launch,
# catalogued with its mainnet target and grepped for in the source. Run
# with MAINNET=1 to FAIL (exit 1) if any testnet value is still present —
# wire that into the mainnet deploy pipeline so a relaxed bound can't ship
# silently. Without MAINNET=1 it just prints the inventory (audit/report).
#
# This is a source scan, not a chain read — it catches values baked into
# code/config, which is where the demo relaxations live.
# ═══════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

MAINNET="${MAINNET:-0}"
FAIL=0
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; NC='\033[0m'

# item "description" "grep-pattern" "file glob" "mainnet target"
check() {
  local desc="$1" pat="$2" glob="$3" target="$4"
  if grep -REn "$pat" $glob >/dev/null 2>&1; then
    if [[ "$MAINNET" == "1" ]]; then
      echo -e "${RED}✗ TESTNET VALUE PRESENT${NC}: $desc  → mainnet: $target"
      grep -REn "$pat" $glob 2>/dev/null | sed 's/^/     /' | head -4
      FAIL=1
    else
      echo -e "${YEL}~${NC} $desc (present) → mainnet: $target"
    fi
  else
    echo -e "${GRN}✓${NC} $desc no longer at the testnet value → mainnet: $target"
  fi
}

echo "═══ Testnet→mainnet config parity ═══  (MAINNET=$MAINNET)"
echo

# Fee tiers — demo thresholds $20K/$50K/$100K → mainnet $1M/$5M/$25M
check "Fee tier 1 threshold \$20K"  '20_000 \* PRECISION' 'contracts/market/src/trading.rs' '$1M'
check "Fee tier 2 threshold \$50K"  '50_000 \* PRECISION' 'contracts/market/src/trading.rs' '$5M'
check "Fee tier 3 threshold \$100K" '100_000 \* PRECISION' 'contracts/market/src/trading.rs' '$25M'
check "Web fee-tier mirror \$20K"   'minVolume: 20_000' 'web/lib/utils/constants.ts' '$1M'

# Leverage / margin — 10x / 1% MM (lean v1 keeps 10x; MM raise is P5-2)
check "Max leverage 10x default"    'max_leverage: 10' 'contracts/noether_common/src/types.rs' '10x lean v1 (25x BTC/ETH later, ramped)'
check "Maintenance margin 1%"       'maintenance_margin_bps: 100' 'contracts/noether_common/src/types.rs' 'MM=IM/2 (P5-2): 2% @25x, 5% @10x'

# Faucet — must be OFF or gated at mainnet
check "Faucet daily limit 1000 USDC" 'DAILY_LIMIT_USDC = 1000' 'web/lib/stellar/faucet.ts' 'faucet DISABLED on mainnet'

# Hardcoded UI stats (should be replaced by /v1/markets/stats before mainnet)
check "Hardcoded OI \$1.2M"          "1\.2M|1_200_000" 'web/app/trade/page.tsx' 'real OI from /v1/markets/stats'

echo
if [[ "$MAINNET" == "1" && "$FAIL" == "1" ]]; then
  echo -e "${RED}PARITY GATE FAILED — testnet values still present. Do not launch.${NC}"
  exit 1
fi
[[ "$MAINNET" == "1" ]] && echo -e "${GRN}Parity gate passed.${NC}"
echo "(run with MAINNET=1 to enforce as a launch gate)"
