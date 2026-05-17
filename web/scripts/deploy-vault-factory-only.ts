/**
 * Redeploy ONLY vault_factory (e.g. after adding view fns).
 * Reuses existing market + usdc from contracts.json, deposits the new
 * address back in. Keeps referral untouched.
 *
 * Run: npx tsx web/scripts/deploy-vault-factory-only.ts
 */

import {
  Keypair,
  Contract,
  TransactionBuilder,
  Operation,
  Networks,
  BASE_FEE,
  Address,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import * as dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes, createHash } from 'crypto';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ROOT = path.resolve(__dirname, '../..');
const CONTRACTS_JSON = path.join(ROOT, 'contracts.json');
const WASM = path.join(ROOT, 'contracts/target/wasm/vault_factory.wasm');

const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY;
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

if (!ADMIN_SECRET) { console.error('ADMIN_SECRET_KEY missing'); process.exit(1); }
if (!existsSync(CONTRACTS_JSON)) { console.error('contracts.json missing'); process.exit(1); }
if (!existsSync(WASM)) { console.error(`WASM missing at ${WASM} — run build_contracts.sh first`); process.exit(1); }

const cfg = JSON.parse(readFileSync(CONTRACTS_JSON, 'utf8'));
const marketId = cfg.contracts.market as string;
const usdcId   = cfg.contracts.usdcToken as string;

const admin = Keypair.fromSecret(ADMIN_SECRET);
const adminPublic = admin.publicKey();
const server = new rpc.Server(RPC_URL);

console.log('rpc      :', RPC_URL);
console.log('deployer :', adminPublic);
console.log('market   :', marketId);
console.log('usdc     :', usdcId);
console.log('old vf   :', cfg.contracts.vaultFactory ?? '(none)');
console.log('');

async function submit(tx: any, label: string) {
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) { console.error(`sim fail ${label}:`, sim.error); process.exit(1); }
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(admin);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') { console.error(`send fail ${label}:`, JSON.stringify(sent.errorResult, null, 2)); process.exit(1); }
  let r = await server.getTransaction(sent.hash);
  let i = 0;
  while (r.status === 'NOT_FOUND' && i < 30) { await new Promise((x) => setTimeout(x, 1000)); r = await server.getTransaction(sent.hash); i++; }
  if (r.status !== 'SUCCESS') { console.error(`final ${label}:`, r.status); process.exit(1); }
  return r;
}

(async () => {
  const wasm = readFileSync(WASM);
  const wasmHash = createHash('sha256').update(wasm).digest();
  console.log(`wasm size: ${wasm.length} bytes`);
  console.log(`wasm hash: ${wasmHash.toString('hex')}`);

  // 1. upload
  {
    const acc = await server.getAccount(adminPublic);
    const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(Operation.uploadContractWasm({ wasm })).setTimeout(60).build();
    await submit(tx, 'upload');
    console.log('✓ uploaded');
  }

  // 2. deploy new instance
  const salt = randomBytes(32);
  let cid = '';
  {
    const acc = await server.getAccount(adminPublic);
    const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(Operation.createCustomContract({
        address: new Address(adminPublic), wasmHash, salt,
      })).setTimeout(60).build();
    const res = await submit(tx, 'deploy');
    const ret = (res as any).returnValue as xdr.ScVal | undefined;
    if (!ret) { console.error('no returnValue'); process.exit(1); }
    cid = Address.fromScVal(ret).toString();
    console.log('✓ deployed:', cid);
  }

  // 3. initialize
  {
    const acc = await server.getAccount(adminPublic);
    const c = new Contract(cid);
    const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(c.call('initialize',
        new Address(adminPublic).toScVal(),
        new Address(marketId).toScVal(),
        new Address(usdcId).toScVal(),
      )).setTimeout(60).build();
    await submit(tx, 'initialize');
    console.log('✓ initialized');
  }

  // 4. update contracts.json
  cfg.contracts.vaultFactory = cid;
  cfg.deployedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  writeFileSync(CONTRACTS_JSON, JSON.stringify(cfg, null, 2) + '\n');
  console.log('');
  console.log('contracts.json updated:');
  console.log('  vaultFactory =', cid);
})().catch((e) => { console.error('fatal:', e); process.exit(1); });
