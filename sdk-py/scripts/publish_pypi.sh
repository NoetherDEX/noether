#!/usr/bin/env bash
# Build and upload noether-sdk to PyPI.
# Requires: TWINE_USERNAME=__token__ TWINE_PASSWORD=<pypi-api-token>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${TWINE_PASSWORD:-}" ]]; then
  echo "Set TWINE_USERNAME=__token__ and TWINE_PASSWORD to your PyPI API token." >&2
  exit 1
fi

export TWINE_USERNAME="${TWINE_USERNAME:-__token__}"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck source=/dev/null
source .venv/bin/activate
pip install -q build hatchling twine

# dist/ must only contain Python sdist/wheel — never npm pack output (noether-sdk-*.tgz).
rm -rf dist/
python -m build

twine check dist/noether_sdk-*
twine upload dist/noether_sdk-*

echo "Published $(python -c "import tomllib; print(tomllib.load(open('pyproject.toml','rb'))['project']['version'])") to PyPI."
