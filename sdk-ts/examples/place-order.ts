/**
 * noether-sdk — place-order example.
 *
 * End-to-end:
 *   1. Generate a fresh Stellar keypair and fund it via Friendbot.
 *   2. Issue an API key by signing a wallet challenge.
 *   3. Prepare an open_position transaction through the SDK.
 *   4. Sign the prepared XDR locally with the keypair.
 *   5. Submit the signed XDR and poll until SUCCESS / FAILED.
 *
 * NOTE: Friendbot only provides XLM. The open_position step needs testnet
 * USDC collateral — fund the wallet at https://testnet.noether.exchange/faucet
 * before step 3, or it will fail.
 *
 * Run:
 *   npx tsx sdk-ts/examples/place-order.ts http://127.0.0.1:4000
 */

import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { NoetherClient } from '../src/index.js';

async function main() {
  const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4000';
  const kp = Keypair.random();
  const address = kp.publicKey();

  console.log(`generated keypair: ${address}`);

  console.log('funding via friendbot...');
  const fund = await fetch(`https://friendbot.stellar.org/?addr=${address}`);
  if (!fund.ok) {
    throw new Error(`friendbot failed (${fund.status}): ${await fund.text()}`);
  }
  await new Promise((r) => setTimeout(r, 4000));

  const client = new NoetherClient({ baseUrl });

  const issued = await client.issueKey({
    address,
    signer: (data) => Buffer.from(kp.sign(data)),
    label: 'sdk-example',
  });
  console.log(`issued key: ${issued.keyId}`);

  const authed = client.withCredentials({ keyId: issued.keyId, secret: issued.secret });

  const me = await authed.account.me();
  console.log('me:', me);

  const result = await authed.executeTrade({
    request: {
      op: 'open_position',
      asset: 'XLM',
      collateral: 1_000_0000000n, // 1000 XLM (7 decimals)
      leverage: 2,
      direction: 'Long',
    },
    signer: (xdr) => {
      const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      tx.sign(kp);
      return tx.toXDR();
    },
  });

  console.log('prepared:', { trader: result.prepared.trader, op: result.prepared.op });
  console.log('submitted:', result.submitted);
}

main().catch((err) => {
  console.error('example failed:', err);
  process.exit(1);
});
