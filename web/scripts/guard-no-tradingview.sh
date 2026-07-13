#!/usr/bin/env sh
# scripts/guard-no-tradingview.sh
#
# Hard-blocks TradingView Advanced Charts / Trading Platform library files from
# entering this PUBLIC git repo.
#
# The Free Advanced Charts Agreement, Section 2.5, forbids hosting the library
# in a public repository. Section 7.5 sets liquidated damages at US$50,000 per
# breach. Prevention is the only cheap option: once the files are in git
# history, "git rm" is NOT enough (they remain in history = still a breach) and
# you would need a full history rewrite + force-push to comply.
#
# Usage:
#   scripts/guard-no-tradingview.sh          # scan STAGED files  (pre-commit hook)
#   scripts/guard-no-tradingview.sh --all    # scan ALL tracked   (CI backstop)

set -u

mode="${1:-staged}"

case "$mode" in
  --all|all) files=$(git ls-files) ;;
  *)         files=$(git diff --cached --name-only --diff-filter=ACM) ;;
esac

[ -z "$files" ] && exit 0

SIZE_FLOOR=300000   # bytes: the TV bundle is multi-MB; hand-written source is not
bad=""

OLDIFS=$IFS
IFS='
'
for f in $files; do
  # 1) Forbidden directories / unmistakable TradingView bundle filenames.
  case "$f" in
    charting_library/*|*/charting_library/* |\
    datafeeds/*|*/datafeeds/* |\
    *charting_library.standalone.js|*charting_library.min.js|\
    *charting_library.esm.js|*charting_library.js)
      bad="$bad  [path]    $f
"
      continue
      ;;
  esac

  # 2) Large JS/CSS/HTML carrying a TradingView marker — catches a bundle that
  #    was renamed or dropped outside the folders above. The extension gate
  #    below also means dependency metadata (package-lock.json, .npmrc, etc.)
  #    is never flagged for merely naming the package.
  case "$f" in
    *.js|*.mjs|*.cjs|*.css|*.html|*.map)
      size=$(git cat-file -s ":$f" 2>/dev/null || echo 0)
      case "$size" in ''|*[!0-9]*) size=0 ;; esac
      if [ "$size" -gt "$SIZE_FLOOR" ] && \
         git show ":$f" 2>/dev/null | grep -q "TradingView"; then
        bad="$bad  [content] $f (${size} bytes, contains 'TradingView')
"
      fi
      ;;
  esac
done
IFS=$OLDIFS

if [ -n "$bad" ]; then
  printf '\n=========================================================================\n'
  printf 'BLOCKED: TradingView Advanced Charts library files detected in the commit:\n\n'
  printf '%s\n' "$bad"
  printf 'The Free Advanced Charts Agreement forbids the library in a public repo\n'
  printf '(Section 2.5); breach = US$50,000 (Section 7.5). Do NOT commit it.\n\n'
  printf 'Vendor it privately instead:\n'
  printf '  - install as a private npm dependency (stays in node_modules/, ignored)\n'
  printf '  - copy static files into web/public/charting_library/ at BUILD time only\n\n'
  printf 'False positive? Keep your own code OUT of charting_library/ and datafeeds/.\n'
  printf 'Emergency bypass (human judgment only): git commit --no-verify\n'
  printf '=========================================================================\n\n'
  exit 1
fi

exit 0
