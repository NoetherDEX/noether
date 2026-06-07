/**
 * Seed the PRODUCTION vault with USDC liquidity (one-shot).
 *
 * Funds the freshly-deployed prod vault so it can be the counterparty to trades.
 *
 * WHY deposit() (not a plain transfer): the vault pays winning traders out of an
 * internal `total_usdc` counter that is ONLY incremented by deposit() — a raw
 * USDC transfer to the vault would sit there uncounted and settlements would
 * revert. And because the admin (…LOLN) is the USDC issuer, deposit()'s inner
 * `transfer(from=admin → vault)` ISSUES the USDC straight into the vault (no
 * prior balance/trustline needed). The NOE LP shares deposit() emits go back to
 * the issuer (…LOLN) and are ignored — there is no NOE to manage here.
 *
 * Safety: simulates before sending, so if anything reverts (incl. the NOE→issuer
 * step) we see it and abort WITHOUT a broken on-chain tx.
 *
 * Reads the NEW vault from contracts.production.json (the .env / Vercel flip
 * hasn't happened yet at seed time). Override with an arg or NEXT_PUBLIC_VAULT_ID.
 *
 * Usage:
 *   npx tsx web/scripts/seed-production-vault.ts            # interactive
 *   npx tsx web/scripts/seed-production-vault.ts <VAULT_ID> # explicit vault
 *   npx tsx web/scripts/seed-production-vault.ts --yes      # skip the prompt
 */

import {
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Address,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import * as dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const ROOT = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(ROOT, '.env') });

const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY;
const USDC_TOKEN_ID = process.env.NEXT_PUBLIC_USDC_TOKEN_ID;
const RPC_URL =
  process.env.SOROBAN_RPC_URL || process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

// 5,000,000 USDC at 7 decimals
const SEED_USDC = 5_000_000;
const AMOUNT_RAW = BigInt(SEED_USDC) * BigInt(10_000_000);

const PROD_JSON = path.join(ROOT, 'contracts.production.json');

const rawArgs = process.argv.slice(2);
const skipConfirm = rawArgs.includes('-y') || rawArgs.includes('--yes');
const vaultArg = rawArgs.find((a) => !a.startsWith('-'));

function fail(msg: string): never {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}

function resolveVault(): { id: string; source: string } {
  if (vaultArg) return { id: vaultArg, source: 'arg' };
  if (existsSync(PROD_JSON)) {
    const j = JSON.parse(readFileSync(PROD_JSON, 'utf8'));
    const v = j?.contracts?.vault;
    if (v) return { id: v as string, source: 'contracts.production.json' };
  }
  if (process.env.NEXT_PUBLIC_VAULT_ID) {
    return { id: process.env.NEXT_PUBLIC_VAULT_ID, source: '.env' };
  }
  fail(
    'Vault address not found. Run scripts/deploy_production.sh first (it writes ' +
      'contracts.production.json), or pass the vault id as an argument.',
  );
}

function confirm(question: string): Promise<boolean> {
  if (skipConfirm) return Promise.resolve(true);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) =>
    rl.question(question, (a) => {
      rl.close();
      res(a.trim().toLowerCase() === 'y');
    }),
  );
}

async function submit(server: rpc.Server, tx: any, signer: Keypair, label: string) {
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) fail(`${label} would fail (simulation): ${sim.error}`);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(signer);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    fail(`${label} send failed: ${JSON.stringify(sent.errorResult, null, 2)}`);
  }
  console.log(`  tx: ${sent.hash}`);
  let res = await server.getTransaction(sent.hash);
  for (let i = 0; res.status === 'NOT_FOUND' && i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await server.getTransaction(sent.hash);
  }
  if (res.status !== 'SUCCESS') fail(`${label} did not succeed: ${res.status}`);
  return res;
}

async function main() {
  console.log('='.repeat(64));
  console.log('Noether — Seed PRODUCTION vault with USDC');
  console.log('='.repeat(64));

  if (!ADMIN_SECRET || ADMIN_SECRET.includes('YOUR_SECRET')) {
    fail('ADMIN_SECRET_KEY (the …LOLN prod admin) is not set in .env');
  }
  if (!USDC_TOKEN_ID) fail('NEXT_PUBLIC_USDC_TOKEN_ID is not set in .env');

  const admin = Keypair.fromSecret(ADMIN_SECRET);
  const adminPk = admin.publicKey();
  const { id: vaultId, source } = resolveVault();
  const server = new rpc.Server(RPC_URL);
  const vault = new Contract(vaultId);

  console.log('\nConfiguration:');
  console.log(`  Network : ${RPC_URL}`);
  console.log(`  Admin   : ${adminPk}   (USDC issuer)`);
  console.log(`  Vault   : ${vaultId}   (from ${source})`);
  console.log(`  USDC    : ${USDC_TOKEN_ID}`);
  console.log(`  Seed    : ${SEED_USDC.toLocaleString()} USDC   (${AMOUNT_RAW} raw)`);
  console.log('');

  if (!(await confirm('Deposit 5,000,000 USDC into this vault? [y/N] '))) {
    console.log('Aborted.');
    process.exit(0);
  }

  console.log('\n[1/2] deposit() — issues 5,000,000 USDC into the vault + sets total_usdc...');
  const account = await server.getAccount(adminPk);
  const depositTx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      vault.call(
        'deposit',
        new Address(adminPk).toScVal(),
        nativeToScVal(AMOUNT_RAW, { type: 'i128' }),
      ),
    )
    .setTimeout(60)
    .build();
  await submit(server, depositTx, admin, 'deposit');
  console.log('  ✓ deposited');

  console.log('\n[2/2] Verifying pool info...');
  const acc2 = await server.getAccount(adminPk);
  const infoTx = new TransactionBuilder(acc2, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(vault.call('get_pool_info'))
    .setTimeout(30)
    .build();
  const infoSim = await server.simulateTransaction(infoTx);
  if (rpc.Api.isSimulationSuccess(infoSim) && infoSim.result?.retval) {
    const pi = scValToNative(infoSim.result.retval) as Record<string, unknown>;
    const usdc = Number(pi.total_usdc ?? 0) / 10_000_000;
    console.log(`  total_usdc : ${usdc.toLocaleString()} USDC`);
    if (pi.aum !== undefined) console.log(`  aum        : ${Number(pi.aum) / 10_000_000}`);
  } else {
    console.log('  (could not read pool info — check manually with get_pool_info)');
  }

  console.log('\n' + '='.repeat(64));
  console.log('SUCCESS — vault seeded with 5,000,000 USDC.');
  console.log('='.repeat(64));
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
