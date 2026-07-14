# Build stage — same pattern as api/Dockerfile, but for the indexer.
FROM node:20-alpine AS builder
WORKDIR /repo

ENV HUSKY=0
ENV CI=true

# Copy the whole monorepo (kept small via .dockerignore).
COPY . .

RUN npm ci --ignore-scripts
RUN npm run build:packages
RUN npm run build -w @noether/indexer

# Runtime stage.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HUSKY=0
ENV CI=true

COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY indexer/package.json ./indexer/
COPY sdk-ts/package.json ./sdk-ts/
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/tx-builders/package.json ./packages/tx-builders/
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /repo/packages/types/dist  ./packages/types/dist
COPY --from=builder /repo/packages/shared/dist ./packages/shared/dist
COPY --from=builder /repo/packages/db/dist     ./packages/db/dist
COPY --from=builder /repo/indexer/dist         ./indexer/dist

COPY contracts.json ./contracts.json
COPY indexer/migrations ./indexer/migrations

CMD ["node", "indexer/dist/index.js"]
