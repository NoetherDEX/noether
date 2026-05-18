/**
 * Admin-only tx: set the referral contract's min_code_volume threshold.
 *
 *   npx tsx web/scripts/referral-set-min-volume.ts 0
 *
 * Lowering this to 0 lets anyone register a code, regardless of their
 * 14-day trading volume. Useful for testnet / open beta.
 *
 * Reads ADMIN_SECRET_KEY from .env (root).
 */

import {
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  rpc,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const ROOT = path.resolve(__dirname, '../..');
const cfg = JSON.parse(readFileSync(path.join(ROOT, 'contracts.json'), 'utf8'));
const REFERRAL = cfg.contracts.referral as string;

const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY;
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

if (!ADMIN_SECRET) {
  console.error('ADMIN_SECRET_KEY missing in .env');
  process.exit(1);
}

const arg = process.argv[2];
if (!arg) {
  console.error('usage: tsx referral-set-min-volume.ts <i128 amount>');
  console.error('       0           → no volume requirement');
  console.error('       100_0000000 → 100 USDC (7-decimal precision)');
  process.exit(1);
}
const newVolume = BigInt(arg);

const admin = Keypair.fromSecret(ADMIN_SECRET);
const server = new rpc.Server(RPC_URL);

(async () => {
  console.log('referral :', REFERRAL);
  console.log('admin    :', admin.publicKey());
  console.log('newVolume:', newVolume.toString());

  const acc = await server.getAccount(admin.publicKey());
  const c = new Contract(REFERRAL);
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(c.call('set_min_code_volume', nativeToScVal(newVolume, { type: 'i128' })))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    console.error('simulation failed:', sim.error);
    process.exit(1);
  }

  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(admin);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    console.error('send failed:', JSON.stringify(sent.errorResult, null, 2));
    process.exit(1);
  }
  let r = await server.getTransaction(sent.hash);
  let i = 0;
  while (r.status === 'NOT_FOUND' && i < 30) {
    await new Promise((x) => setTimeout(x, 1000));
    r = await server.getTransaction(sent.hash);
    i++;
  }
  if (r.status !== 'SUCCESS') {
    console.error('final status:', r.status);
    process.exit(1);
  }
  console.log('✓ done, tx:', sent.hash);
})().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
