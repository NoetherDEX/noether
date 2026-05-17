# Build stage — compiles TypeScript for the @noether/api service.
# Builds the whole monorepo from the root so npm workspace deps
# (@noether/types, @noether/shared, @noether/tx-builders) get linked
# before the api package is compiled.
FROM node:20-alpine AS builder
WORKDIR /repo

# Skip husky in CI/container builds — .git is excluded by .dockerignore
# so the `prepare: husky` script blows up otherwise.
ENV HUSKY=0
ENV CI=true

# Copy lockfiles + workspace manifests first for better cache reuse.
COPY package.json package-lock.json tsconfig.base.json ./
COPY api/package.json ./api/
COPY indexer/package.json ./indexer/
COPY sdk-ts/package.json ./sdk-ts/
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tx-builders/package.json ./packages/tx-builders/

# Install all workspaces (deterministic).
RUN npm ci --workspaces --include-workspace-root

# Now bring in sources.
COPY packages ./packages
COPY api ./api
COPY indexer ./indexer
COPY sdk-ts ./sdk-ts

# Build the workspace deps first (types → shared → tx-builders),
# then the api itself.
RUN npm run build:packages
RUN npm run build -w @noether/api

# Runtime stage — only ships compiled JS + production deps.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HUSKY=0
ENV CI=true

# Re-install with production-only deps for the api workspace.
COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tx-builders/package.json ./packages/tx-builders/
RUN npm ci --omit=dev --ignore-scripts --workspaces --include-workspace-root --workspace=@noether/api

# Bring in built artifacts.
COPY --from=builder /repo/packages/types/dist     ./packages/types/dist
COPY --from=builder /repo/packages/shared/dist    ./packages/shared/dist
COPY --from=builder /repo/packages/tx-builders/dist ./packages/tx-builders/dist
COPY --from=builder /repo/api/dist                ./api/dist

# contracts.json is read by the API on startup.
COPY contracts.json ./contracts.json

EXPOSE 4000
CMD ["node", "api/dist/index.js"]
