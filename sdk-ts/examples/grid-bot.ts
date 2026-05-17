/**
 * @noether/sdk — grid market-maker (skeleton).
 *
 * Educational only. Watches the BTC oracle price and places one buy
 * order below and one sell order above the current price, refreshing
 * every 30 seconds. Phase 8 will replace the polling loop with a
 * WebSocket subscription on `ticker.BTC`.
 *
 * Run:
 *   API_KEY_ID=nk_... API_KEY_SECRET=... STELLAR_SECRET=S... \
 *     npx tsx sdk-ts/examples/grid-bot.ts http://127.0.0.1:4000
 */

import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { NoetherClient } from '../src/index.js';

const ASSET = 'BTC';
const COLLATERAL = 100_0000000n; // 100 USDC scaled
const LEVERAGE = 3;
const SPREAD_BPS = 25; // 0.25% above / below mark
const TICK_INTERVAL_MS = 30_000;

async function main() {
  const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4000';
  const keyId = required('API_KEY_ID');
  const secret = required('API_KEY_SECRET');
  const stellarSecret = required('STELLAR_SECRET');
  const kp = Keypair.fromSecret(stellarSecret);

  const client = new NoetherClient({ baseUrl, credentials: { keyId, secret } });

  const sign = (xdr: string) => {
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    tx.sign(kp);
    return tx.toXDR();
  };

  console.log(`grid bot started for ${ASSET}, refresh every ${TICK_INTERVAL_MS / 1000}s`);

  while (true) {
    try {
      const price = await client.oracle.getPrice(ASSET);
      const markPrice = BigInt(price.price);
      const buyAt = (markPrice * BigInt(10_000 - SPREAD_BPS)) / 10_000n;
      const sellAt = (markPrice * BigInt(10_000 + SPREAD_BPS)) / 10_000n;
      console.log(
        `[${new Date().toISOString()}] mark=${price.priceFloat.toFixed(2)} buy=${buyAt} sell=${sellAt}`,
      );

      await client.executeTrade({
        request: {
          op: 'place_limit_order',
          asset: ASSET,
          direction: 'Long',
          collateral: COLLATERAL,
          leverage: LEVERAGE,
          triggerPrice: buyAt,
          triggerCondition: 'Below',
          slippageToleranceBps: 50,
        },
        signer: sign,
      });

      await client.executeTrade({
        request: {
          op: 'place_limit_order',
          asset: ASSET,
          direction: 'Short',
          collateral: COLLATERAL,
          leverage: LEVERAGE,
          triggerPrice: sellAt,
          triggerCondition: 'Above',
          slippageToleranceBps: 50,
        },
        signer: sign,
      });
    } catch (err) {
      console.error('tick failed:', (err as Error).message);
    }
    await sleep(TICK_INTERVAL_MS);
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var: ${name}`);
  return v;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('grid bot crashed:', err);
  process.exit(1);
});
