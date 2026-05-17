# Build stage — compiles TypeScript for the @noether/api service.
# Builds the whole monorepo so workspace deps (@noether/types,
# @noether/shared, @noether/tx-builders) are linked before the api
# package is compiled.
FROM node:20-alpine AS builder
WORKDIR /repo

# Skip husky in container builds — .git is excluded by .dockerignore
# so the `prepare: husky` script crashes otherwise.
ENV HUSKY=0
ENV CI=true

# Copy the whole monorepo first — simpler and more robust than the
# per-package.json layer cache; the .dockerignore already keeps the
# context tiny (no node_modules / web/ / sdk-py / docs / target).
COPY . .

# Default npm ci already installs root + every workspace member.
RUN npm ci

# Build the workspace deps first, then the api.
RUN npm run build:packages
RUN npm run build -w @noether/api

# Runtime stage — only ships compiled JS + production deps.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HUSKY=0
ENV CI=true

# Re-install with production-only deps.
COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tx-builders/package.json ./packages/tx-builders/
COPY indexer/package.json ./indexer/
COPY sdk-ts/package.json ./sdk-ts/
RUN npm ci --omit=dev

# Bring in built artifacts.
COPY --from=builder /repo/packages/types/dist       ./packages/types/dist
COPY --from=builder /repo/packages/shared/dist      ./packages/shared/dist
COPY --from=builder /repo/packages/tx-builders/dist ./packages/tx-builders/dist
COPY --from=builder /repo/api/dist                  ./api/dist

# contracts.json is read by the API on startup.
COPY contracts.json ./contracts.json

EXPOSE 4000
CMD ["node", "api/dist/index.js"]
