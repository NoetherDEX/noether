# Build stage — same monorepo install pattern as api/Dockerfile, but
# compiles the indexer worker.
FROM node:20-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY api/package.json ./api/
COPY indexer/package.json ./indexer/
COPY sdk-ts/package.json ./sdk-ts/
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tx-builders/package.json ./packages/tx-builders/

RUN npm ci --workspaces --include-workspace-root

COPY packages ./packages
COPY api ./api
COPY indexer ./indexer
COPY sdk-ts ./sdk-ts

RUN npm run build:packages
RUN npm run build -w @noether/indexer

# Runtime stage.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY indexer/package.json ./indexer/
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --omit=dev --workspaces --include-workspace-root --workspace=@noether/indexer

COPY --from=builder /repo/packages/types/dist  ./packages/types/dist
COPY --from=builder /repo/packages/shared/dist ./packages/shared/dist
COPY --from=builder /repo/indexer/dist         ./indexer/dist

COPY contracts.json ./contracts.json
COPY indexer/migrations ./indexer/migrations

CMD ["node", "indexer/dist/index.js"]
