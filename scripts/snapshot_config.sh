#!/usr/bin/env bash
# Config snapshot (MAINNET-RUNBOOK §4.8): read every admin-relevant view from
# the six deployed contracts and write one JSON artifact next to the release
# hashes. View-only — nothing is signed or submitted.
#
#   ./scripts/snapshot_config.sh [prod|staging|mainnet] [out.json]
#
# Env overrides: SNAPSHOT_SOURCE (CLI identity for simulation, default
# noether_admin), SNAPSHOT_PAIRS (space-separated asset list for the per-pair
# risk ladder).
set -uo pipefail

ENV_NAME="${1:-prod}"
case "$ENV_NAME" in
  prod)    MANIFEST="contracts.json" ;;
  staging) MANIFEST="contracts.staging.json" ;;
  mainnet) MANIFEST="contracts.mainnet.json" ;;
  *) echo "usage: $0 prod|staging|mainnet [out.json]"; exit 1 ;;
esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/$MANIFEST"
[[ -f "$MANIFEST" ]] || { echo "❌ missing $MANIFEST"; exit 1; }

NETWORK=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['network'])")
SOURCE="${SNAPSHOT_SOURCE:-noether_admin}"
PAIRS="${SNAPSHOT_PAIRS:-BTC ETH XLM SOL XRP ADA BNB TRX HYPE DOGE ZEC LINK BCH LTC}"
OUT="${2:-$ROOT/audit/config-snapshots/${ENV_NAME}-$(date +%F).json}"
mkdir -p "$(dirname "$OUT")"
TSV="$(mktemp)"

addr() { python3 -c "import json;print(json.load(open('$MANIFEST'))['contracts'].get('$1',''))"; }

view() { # contract-label contract-id fn [extra args…]
  local label="$1" id="$2" fn="$3"; shift 3
  local out
  out=$(stellar contract invoke --id "$id" --network "$NETWORK" --source "$SOURCE" -- "$fn" "$@" 2>/dev/null)
  if [[ -z "$out" ]]; then out='"<error>"'; fi
  printf '%s\t%s\t%s\n' "$label" "$fn${1:+ $2}" "$out" >> "$TSV"
}

echo "→ snapshot $ENV_NAME ($NETWORK) via $SOURCE → $OUT"

MARKET=$(addr market); VAULT=$(addr vault); FACTORY=$(addr vaultFactory)
REFERRAL=$(addr referral); ROUTER=$(addr noetherRouter); SHIM=$(addr noeracleShim)

# ── market (no get_admin view; admin lives in instance storage — verify it
#     on StellarExpert's contract-storage tab, and by the multisig-signed
#     init tx itself; this CLI's `contract read` cannot list instance keys) ──
view market "$MARKET" get_pause_state
for p in $PAIRS; do view market "$MARKET" get_asset_risk --asset "$p"; done
INSTANCE_DUMP='"admin not view-exposed - verify via StellarExpert contract storage + the init tx signer"'

# ── vault ──
for f in get_admin get_pool_info get_noe_price get_usdc_balance get_aum \
         get_deposit_fee get_withdraw_fee get_deposit_cap get_aum_cap \
         get_withdraw_cooldown get_buffer_target_bps get_reserve_cap \
         get_buffer_balance get_shortfall_reserve get_reserved_payout \
         get_usdc_token get_noe_token get_market_contract; do
  view vault "$VAULT" "$f"
done

# ── factory / referral / router / shim ──
for f in get_admin get_market get_usdc; do view vaultFactory "$FACTORY" "$f"; done
for f in get_admin get_market get_config; do view referral "$REFERRAL" "$f"; done
for f in get_admin get_market get_noeracle get_stork_config \
         get_stork_strict_assets get_reflector_config; do
  view noetherRouter "$ROUTER" "$f"
done
for f in get_admin get_noeracle get_backend; do view noeracleShim "$SHIM" "$f"; done

GIT_COMMIT=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)
TSV_PATH="$TSV" OUT_PATH="$OUT" ENV_NAME="$ENV_NAME" NETWORK="$NETWORK" \
MANIFEST_PATH="$MANIFEST" GIT_COMMIT="$GIT_COMMIT" INSTANCE_DUMP="$INSTANCE_DUMP" \
python3 << 'PYEOF'
import json, os, datetime
snap = {
    'env': os.environ['ENV_NAME'], 'network': os.environ['NETWORK'],
    'takenAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'gitCommit': os.environ['GIT_COMMIT'],
    'manifest': json.load(open(os.environ['MANIFEST_PATH'])),
    'contracts': {},
}
for line in open(os.environ['TSV_PATH']):
    label, fn, raw = line.rstrip('\n').split('\t', 2)
    try: val = json.loads(raw)
    except Exception: val = raw
    snap['contracts'].setdefault(label, {})[fn] = val
try: snap['contracts'].setdefault('market', {})['instance_storage'] = json.loads(os.environ['INSTANCE_DUMP'])
except Exception: snap['contracts'].setdefault('market', {})['instance_storage'] = os.environ['INSTANCE_DUMP']
errors = sum(1 for c in snap['contracts'].values() for v in c.values() if v == '<error>')
json.dump(snap, open(os.environ['OUT_PATH'], 'w'), indent=2, default=str)
total = sum(len(c) for c in snap['contracts'].values())
print(f"✅ {os.environ['OUT_PATH']}: {total} entries, {errors} errors")
PYEOF
rm -f "$TSV"
