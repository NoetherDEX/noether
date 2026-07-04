# noether-sdk

Official TypeScript SDK for the [Noether](https://noether.exchange) decentralized perpetual exchange on Stellar / Soroban.

Type-safe, fetch-based, and split into focused sub-clients per resource. Works in Node 18+ and modern browsers.

## Install

```bash
npm install noether-sdk @stellar/stellar-sdk
```

`@stellar/stellar-sdk` is only required if you want to sign locally with a `Keypair`; for browser wallets you can plug Freighter / Stellar Wallets Kit signers directly into the SDK helpers.

## Quick start — public reads

```ts
import { NoetherClient } from 'noether-sdk';

const client = new NoetherClient({ baseUrl: 'https://api.noether.exchange' });

const markets = await client.markets.list();
const btc = await client.oracle.getPrice('BTC');
console.log('BTC oracle:', btc.priceFloat, 'at', new Date(btc.timestamp * 1000));
```

## Authed: account info

```ts
const client = new NoetherClient({
  baseUrl: 'https://api.noether.exchange',
  credentials: { keyId: 'nk_...', secret: '...' },
});

const me = await client.account.me();
const positions = await client.account.positions();
```

## Issue an API key (one-shot)

```ts
import { Keypair } from '@stellar/stellar-sdk';

const kp = Keypair.fromSecret(process.env.STELLAR_SECRET!);
const issued = await client.issueKey({
  address: kp.publicKey(),
  signer: (challenge) => Buffer.from(kp.sign(challenge)),
  label: 'mm-bot-1',
});
console.log(issued.keyId, issued.secret); // store the secret immediately
```

## Place an order — `executeTrade`

> Trading needs collateral: fund your wallet with testnet USDC from the
> [Noether faucet](https://testnet.noether.exchange/faucet) (Friendbot only
> provides XLM) before placing orders.

```ts
import { Networks, TransactionBuilder } from '@stellar/stellar-sdk';

const result = await client.executeTrade({
  request: {
    op: 'open_position',
    asset: 'XLM',
    collateral: 1000n * 10_000_000n, // 1000 USDC (7 decimals)
    leverage: 2,
    direction: 'Long',
  },
  signer: (xdr) => {
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    tx.sign(kp);
    return tx.toXDR();
  },
});
console.log(result.submitted.hash, result.submitted.status);
```

`executeTrade` calls `orders.prepare` → asks your `signer` for the signed XDR → calls `tx.submit` and polls until `SUCCESS` / `FAILED` / timeout.

## Sub-client cheatsheet

| Path                            | Method                                 | Auth |
|---------------------------------|----------------------------------------|------|
| `client.health.ping()`          | health probe                           | no   |
| `client.markets.list()`         | all supported markets + oracle prices  | no   |
| `client.markets.get(asset)`     | single market detail                   | no   |
| `client.oracle.getPrice(asset)` | live oracle price                      | no   |
| `client.oracle.getPrices()`     | all asset prices                       | no   |
| `client.events.list(query)`     | raw indexer events (filterable)        | no   |
| `client.keys.betaStatus(addr?)` | closed-beta gating status              | no   |
| `client.keys.create({...})`     | challenge → sign → issue key           | no   |
| `client.keys.list()`            | own API keys                           | yes  |
| `client.keys.revoke(keyId)`     | revoke own key                         | yes  |
| `client.account.me()`           | identity / tier                        | yes  |
| `client.account.positions()`    | position events for owner              | yes  |
| `client.account.orders()`       | order events for owner                 | yes  |
| `client.orders.prepare(req)`    | build unsigned XDR                     | yes  |
| `client.tx.submit(req)`         | submit signed XDR + poll               | yes  |
| `client.executeTrade({...})`    | prepare + sign + submit one-shot       | yes  |
| `client.positions.open({...})`  | open positions (filter by trader)      | no   |
| `client.vaults.list()` / `get(id)` / `trades(id)` / `deposits(id)` / `withdraws(id)` / `feeClaims(id)` | trading-vault marketplace reads | no |
| `client.referral.lookupCode(c)` / `info(address)` | public referral reads | no   |
| `client.referral.me()` / `trades()` / `claims()` | own referral state      | yes  |
| `client.ws()`                   | WebSocket sub-client (see below)       | opt  |

## WebSocket

```ts
const ws = client.ws(); // wss://…/v1/ws, same credentials as the client
await ws.connect(); // resolves on server hello; rejects on timeout/failure
await ws.subscribe('ticker.BTC', (data) => console.log(data));
```

`WsClient` auto-reconnects with exponential backoff, re-sends your login +
subscriptions on every reconnect, and re-sends `account.*` subscriptions
after each login ack. `connect()` rejects instead of hanging when the
gateway is unreachable (`connectTimeoutMs`, default 15s). Server-side
subscription rejections and failed logins surface through the
`onSubscriptionRejected` / `onLogin` callbacks.

## Errors

All API failures throw a typed subclass of `NoetherError`:

```ts
import { AuthError, RateLimitError, BadRequestError, ServerError } from 'noether-sdk';

try {
  await client.markets.get('DOGE');
} catch (err) {
  if (err instanceof BadRequestError) console.error('bad request:', err.body);
  else if (err instanceof RateLimitError) console.error('retry in', err.retryAfterSec);
  else if (err instanceof AuthError) console.error('auth failed');
  else if (err instanceof ServerError) console.error('server boom');
  else throw err;
}
```

## Examples

- [`examples/place-order.ts`](./examples/place-order.ts) — Friendbot funding + key issuance + open_position end-to-end (fund the wallet with testnet USDC from the [faucet](https://testnet.noether.exchange/faucet) first, or the open_position step will fail).
- [`examples/grid-bot.ts`](./examples/grid-bot.ts) — minimal grid market-maker skeleton.

Run with `tsx`:

```bash
npx tsx sdk-ts/examples/place-order.ts http://127.0.0.1:4000
```

## Development

```bash
# from repo root
npm install
npm run build -w noether-sdk          # tsup → dual ESM + CJS + .d.ts
npm run test -w noether-sdk           # vitest unit tests
npm run typecheck -w noether-sdk
```

## Status

Covers the full gateway REST surface plus the `client.ws()` WebSocket sub-client. See [CHANGELOG.md](./CHANGELOG.md).
