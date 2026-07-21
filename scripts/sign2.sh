#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# Two-of-three admin signing helper (post-multisig mainnet ops).
#
#   ./scripts/sign2.sh <CONTRACT_ID> <fn> [-- <fn args…>]
#
# Builds the admin invoke UNSIGNED, signs with K1 (laptop keystore identity
# `batch1_mainnet_admin`), then prints the once-signed XDR for the SECOND
# signature on your phone:
#
#   1. Copy the XDR below (AirDrop / notes / QR).
#   2. On the phone: open https://lab.stellar.org → Transaction Signer →
#      network Mainnet → paste → sign with the wallet (Freighter mobile /
#      LOBSTR import) holding K2.
#   3. Paste the twice-signed XDR back here — the script submits it.
#
# Recovery path is identical with K3 (paper) instead of K2.
# ═════════════════════════════════════════════════════════════════════════════
set -euo pipefail

CONTRACT="${1:?usage: sign2.sh <CONTRACT_ID> <fn> [-- args…]}"; shift
FN="${1:?missing function name}"; shift

IDENTITY="batch1_mainnet_admin"
NET="mainnet"

echo "→ building $CONTRACT.$FN (unsigned)…"
XDR="$(stellar contract invoke --id "$CONTRACT" --source "$IDENTITY" --network "$NET" --build-only -- "$FN" "$@")"

echo "→ signing with K1 ($IDENTITY)…"
XDR1="$(stellar tx sign --sign-with-key "$IDENTITY" --network "$NET" <<< "$XDR")"

echo ""
echo "════════ ONCE-SIGNED XDR — sign with K2 on the phone (lab.stellar.org) ════════"
echo "$XDR1"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
read -r -p "Paste the TWICE-signed XDR (or empty to abort): " XDR2
[[ -n "$XDR2" ]] || { echo "aborted — nothing submitted"; exit 1; }

echo "→ submitting…"
stellar tx send --network "$NET" <<< "$XDR2"
echo "✓ done"
