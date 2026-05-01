# @noether/api

REST + WebSocket gateway for the Noether protocol.

## Status

**Phase 1** — Fastify shell with `/v1/health` and Swagger UI at `/docs`. No real endpoints yet.

## Responsibilities (final form)

- Public read: markets, orderbook (synthetic), trades, candles, funding, oracle prices.
- Authed read: account, positions, orders, fees, referrals.
- Trading relay: prepare + submit Soroban transactions (no custodial keys).
- WebSocket: real-time channels (ticker, trades, orderbook, positions, vault, referral).
- API key management with HMAC auth and tiered rate limiting.

## Layout

```
api/
├── src/
│   ├── index.ts            # entry, lifecycle
│   ├── config.ts           # env loading
│   ├── server.ts           # Fastify factory + plugin registration
│   └── routes/
│       └── health.ts
└── README.md
```

## Development

```bash
# From repo root
npm install

# Type check
npm run typecheck -w @noether/api

# Run dev server (auto-reload)
npm run dev -w @noether/api
# → API listening on http://0.0.0.0:4000
# → http://localhost:4000/v1/health
# → http://localhost:4000/docs
```
