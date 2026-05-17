# Soroban RPC Provider Guide

The Noether indexer, API, frontend, and keeper all rely on a Soroban RPC
endpoint. The choice of provider materially affects reliability and
throughput, so this document captures the options and the configuration
points.

---

## Why this matters

- **Indexer** polls `getEvents` every 1-2 seconds and may hit transient
  rate limits on shared endpoints.
- **API gateway** runs a `simulateTransaction` per public price read; with
  caching this is bounded but not zero.
- **Keeper** historically hit `TRY_AGAIN_LATER` on the public endpoint
  (commit `1dfb73b`) and now retries with backoff.
- **Frontend** reads via the user's browser — usually a different
  origin than the backend, so its RPC choice is independent.

Running indexer + keeper + API together against the public endpoint
**will** trigger rate limits as load grows. Plan for a dedicated endpoint
before any meaningful traffic.

---

## Configuration

All Tranche 2 services read RPC configuration through these environment
variables (resolved by `getRpcUrls()` in `@noether/shared/rpc`):

| Variable             | Effect                                                                 |
|----------------------|------------------------------------------------------------------------|
| `SOROBAN_RPC_URLS`   | Comma-separated list, **primary first**. Wins over `SOROBAN_RPC_URL`. |
| `SOROBAN_RPC_URL`    | Single URL.                                                            |
| _none of the above_  | Falls back to the network default in `network.ts`.                    |

Example: production with one primary plus the public testnet as a soft
fallback:

```env
SOROBAN_RPC_URLS=https://your-paid-endpoint.example/rpc,https://soroban-testnet.stellar.org
```

> **Active failover** (rotate to next URL on `TRY_AGAIN_LATER` /
> `ECONNRESET`) is implemented in the indexer's `fetchEvents` retry
> wrapper but not yet wired across all services. Phase 12 hardens this.

---

## Provider Options

### 1. Public testnet endpoint

```
https://soroban-testnet.stellar.org
```

- Free, immediate, zero setup.
- Rate-limited; aggressive polling triggers `TRY_AGAIN_LATER`.
- Acceptable for: local dev, low-load test, demos with bounded traffic.
- Not acceptable for: production indexer running alongside keeper +
  multiple users.

### 2. Validation Cloud

- **Site:** <https://validationcloud.io/>
- Plans: free tier with low rate-limit, paid plans with dedicated quota.
- Stellar mainnet + testnet supported; Soroban RPC included.
- Pros: well-maintained, predictable SLAs.
- Cons: vendor lock; needs auth header in URL.

### 3. NowNodes

- **Site:** <https://nownodes.io/>
- Multi-chain. Stellar / Soroban available on paid tiers.
- Pros: pay-as-you-go pricing.
- Cons: less Stellar-native focus than Validation Cloud.

### 4. BlockEden

- **Site:** <https://blockeden.xyz/>
- Stellar Soroban RPC offered.
- Pros: per-request pricing, free tier.
- Cons: smaller operator, fewer SLA commitments.

### 5. Self-hosted Stellar Core + Soroban RPC

- Pros: full control, no per-request cost, isolated rate limits.
- Cons: ops burden — Stellar Core syncs continuously, Soroban RPC is a
  separate process, history retention requires storage planning. Recommend
  Hetzner / DigitalOcean dedicated VM, ~16 GB RAM, ~500 GB SSD for
  testnet retention.
- Reference: <https://developers.stellar.org/network/soroban-rpc/admin-guide>.

---

## Recommendation by Stage

| Stage                  | Suggested setup                                                                  |
|------------------------|----------------------------------------------------------------------------------|
| Local dev              | `SOROBAN_RPC_URL=https://soroban-testnet.stellar.org`                            |
| Internal staging       | One paid endpoint as primary, public testnet as fallback                         |
| Production / demo day  | Two paid endpoints (different providers) for fallback diversity                  |
| Mainnet launch         | Self-hosted primary + one paid fallback                                          |

---

## Health Probe (current)

Each service logs the RPC URL it boots with:

- `indexer` — `Indexer starting { rpcUrl, market }`
- `api` — `API listening { host, port, network }` (RPC URL via config dump
  during startup if `LOG_LEVEL=debug`)

When debugging rate-limit issues, grep for `TRY_AGAIN_LATER` in service
logs; `fetchEvents` and the keeper transparently retry up to 3 times with
exponential backoff before bubbling.
