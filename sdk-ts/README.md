# @noether/sdk

Official TypeScript SDK for the [Noether](https://noether.exchange) decentralized perpetual exchange on Stellar / Soroban.

## Status

**Phase 1** — package scaffold with `NoetherClient` + `ping()`. Markets, account, orders, and WebSocket sub-clients ship in Phases 5-8.

## Install (once published)

```bash
npm install @noether/sdk
```

## Quick start

```ts
import { NoetherClient } from '@noether/sdk';

const client = new NoetherClient({
  baseUrl: 'https://api.noether.exchange',
});

const health = await client.ping();
console.log(health); // { status: 'ok', uptime: ..., version: ... }
```

## Build

```bash
# From repo root
npm install
npm run build -w @noether/sdk
```

Outputs both ESM (`dist/index.js`) and CJS (`dist/index.cjs`) plus type
definitions (`dist/index.d.ts`).
