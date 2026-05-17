/**
 * Tranche 2 incremental deploy: vault_factory + referral.
 *
 * - Reuses existing market + usdc addresses from contracts.json.
 * - Uploads each WASM, deploys a contract instance, invokes `initialize`.
 * - Merges the two new addresses into contracts.json (preserving the
 *   existing mockOracle / oracleAdapter / vault / market / usdcToken / noeToken).
 *
 * Usage:  npx tsx web/scripts/deploy-tranche2.ts
 */

import {
  Keypair,
  Contract,
  TransactionBuilder,
  Operation,
  Networks,
  BASE_FEE,
  Address,
  hash,
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
const WASM_DIR = path.join(ROOT, 'contracts/target/wasm');

const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY;
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

if (!ADMIN_SECRET) {
  console.error('ERROR: ADMIN_SECRET_KEY not set in .env');
  process.exit(1);
}
if (!existsSync(CONTRACTS_JSON)) {
  console.error(`ERROR: ${CONTRACTS_JSON} not found`);
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(CONTRACTS_JSON, 'utf8'));
const marketId = cfg.contracts.market as string;
const usdcId = cfg.contracts.usdcToken as string;
if (!marketId || !usdcId) {
  console.error('ERROR: market or usdcToken missing in contracts.json');
  process.exit(1);
}

const admin = Keypair.fromSecret(ADMIN_SECRET);
const adminPublic = admin.publicKey();
const server = new rpc.Server(RPC_URL);

console.log('Network        :', RPC_URL);
console.log('Deployer       :', adminPublic);
console.log('Market         :', marketId);
console.log('USDC           :', usdcId);
console.log('');

async function submit(tx: any, label: string) {
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    console.error(`Simulation failed for ${label}:`, sim.error);
    process.exit(1);
  }
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(admin);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    console.error(`Send failed for ${label}:`, JSON.stringify(sent.errorResult, null, 2));
    process.exit(1);
  }
  let result = await server.getTransaction(sent.hash);
  let attempts = 0;
  while (result.status === 'NOT_FOUND' && attempts < 30) {
    await new Promise((r) => setTimeout(r, 1000));
    result = await server.getTransaction(sent.hash);
    attempts++;
  }
  if (result.status !== 'SUCCESS') {
    console.error(`Tx ${label} final status:`, result.status);
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  return result;
}

async function deploy(name: string, wasmPath: string, initArgs: xdr.ScVal[]): Promise<string> {
  console.log(`──── ${name} ────`);

  const wasm = readFileSync(wasmPath);
  const wasmHash = createHash('sha256').update(wasm).digest();
  console.log(`  wasm size : ${wasm.length} bytes`);
  console.log(`  wasm hash : ${wasmHash.toString('hex')}`);

  // 1. Upload WASM (idempotent — re-upload of the same hash is a no-op
  //    on the host but still a tx; sim will succeed either way).
  {
    const account = await server.getAccount(adminPublic);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(Operation.uploadContractWasm({ wasm }))
      .setTimeout(60)
      .build();
    await submit(tx, `upload ${name}`);
    console.log('  ✓ uploaded');
  }

  // 2. Create contract instance.
  const salt = randomBytes(32);
  let contractId = '';
  {
    const account = await server.getAccount(adminPublic);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(
        Operation.createCustomContract({
          address: new Address(adminPublic),
          wasmHash,
          salt,
        }),
      )
      .setTimeout(60)
      .build();
    const res = await submit(tx, `create ${name}`);
    const ret = (res as any).returnValue as xdr.ScVal | undefined;
    if (!ret) {
      console.error(`  ✗ create returned no value`);
      process.exit(1);
    }
    contractId = Address.fromScVal(ret).toString();
    console.log('  ✓ deployed:', contractId);
  }

  // 3. Invoke initialize.
  {
    const account = await server.getAccount(adminPublic);
    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(contract.call('initialize', ...initArgs))
      .setTimeout(60)
      .build();
    await submit(tx, `init ${name}`);
    console.log('  ✓ initialized');
  }

  return contractId;
}

(async () => {
  const adminScVal = new Address(adminPublic).toScVal();
  const marketScVal = new Address(marketId).toScVal();
  const usdcScVal = new Address(usdcId).toScVal();

  const vaultFactoryId = await deploy(
    'vault_factory',
    path.join(WASM_DIR, 'vault_factory.wasm'),
    [adminScVal, marketScVal, usdcScVal],
  );
  console.log('');

  const referralId = await deploy(
    'referral',
    path.join(WASM_DIR, 'referral.wasm'),
    [adminScVal, marketScVal],
  );
  console.log('');

  cfg.contracts.vaultFactory = vaultFactoryId;
  cfg.contracts.referral = referralId;
  cfg.deployedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  writeFileSync(CONTRACTS_JSON, JSON.stringify(cfg, null, 2) + '\n');
  console.log('contracts.json updated:');
  console.log(JSON.stringify(cfg, null, 2));
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
