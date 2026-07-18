# Hardened T3 keeper — standalone package (NOT in the npm workspaces), so the
# build context is scripts/keeper/ itself, not the repo root:
#   az acr build -r noetheracr2026 -t noether-keeper-t3:vN scripts/keeper
# Contract addresses come from env vars only (no contracts.json baked in) so a
# contract redeploy never requires an image rebuild.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# node directly, not `npm start` — its prestart hook would rerun tsc in a
# runtime stage that has no devDependencies.
CMD ["node", "dist/index.js"]
