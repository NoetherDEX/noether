#!/usr/bin/env bash
# All-in-one web deploy to Azure Container Apps.
#
#   ./scripts/deploy_web_azure.sh staging|prod [tag]
#
# Builds web/ as a per-environment image (NEXT_PUBLIC_* values are INLINED at
# build time) and rolls the matching container app. Build values come from the
# git-ignored web/.env.azure.<env>.local — runtime secrets (ADMIN_SECRET_KEY,
# FEEDBACK_DISCORD_WEBHOOK_URL) live on the container app itself and are never
# touched here. Non-interactive use: DEPLOY_YES=1 ./scripts/deploy_web_azure.sh …
set -euo pipefail

ENV_NAME="${1:-}"
if [[ "$ENV_NAME" != "staging" && "$ENV_NAME" != "prod" ]]; then
  echo "usage: $0 staging|prod [tag]"; exit 1
fi
TAG="${2:-$(date +%Y%m%d-%H%M)}"
ACR=noetheracr2026
RG=noether-rg
if [[ "$ENV_NAME" == "prod" ]]; then APP=noether-web; else APP=noether-web-staging; fi
IMAGE="noether-web:${ENV_NAME}-${TAG}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VALUES="$ROOT/web/.env.azure.${ENV_NAME}.local"
[[ -f "$VALUES" ]] || { echo "❌ missing $VALUES (build-time NEXT_PUBLIC_* values)"; exit 1; }

# Prod ships main-branch code only — the staging branch is the staging site.
if [[ "$ENV_NAME" == "prod" ]]; then
  BRANCH=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)
  if [[ "$BRANCH" != "main" ]]; then
    echo "❌ prod image must build from a main checkout (current branch: $BRANCH)"; exit 1
  fi
fi

BUILD_ARGS=()
COUNT=0
while IFS='=' read -r key value; do
  [[ "$key" =~ ^NEXT_PUBLIC_[A-Z_]+$ ]] || continue
  BUILD_ARGS+=(--build-arg "${key}=${value}")
  COUNT=$((COUNT + 1))
done < "$VALUES"

echo "→ $APP  ($ENV_NAME)  image $IMAGE  — $COUNT build args from $(basename "$VALUES")"
if [[ "${DEPLOY_YES:-}" != "1" ]]; then
  read -r -p "Proceed? [y/N] " ok
  [[ "$ok" == "y" || "$ok" == "Y" ]] || exit 1
fi

az acr build -r "$ACR" -t "$IMAGE" "${BUILD_ARGS[@]}" "$ROOT/web"

if ! az containerapp show -n "$APP" -g "$RG" --query name -o tsv >/dev/null 2>&1; then
  echo "ℹ️  Container app $APP does not exist yet — image is built and pushed."
  echo "   Create it once (with runtime secrets), then re-run this script for updates."
  exit 0
fi

az containerapp update -n "$APP" -g "$RG" --image "$ACR.azurecr.io/$IMAGE" --query "properties.provisioningState" -o tsv
echo "✅ $APP → $IMAGE"
echo "   https://$(az containerapp show -n "$APP" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)"
