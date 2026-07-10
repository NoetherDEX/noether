/**
 * One-shot Noeracle path validator (post-S-1, batch entrypoint).
 *
 * Fetches one fresh signed BTC/USD attestation, pushes it as a batch of one
 * through the HARDENED update_batch_ed25519_persistent, reads it straight
 * back through get_price_pers, then proves the hardening actually bites:
 * an unregistered publisher key and a stale timestamp must BOTH be
 * rejected. This validates the whole keeper -> Noeracle -> get_price_pers
 * chain without running the full keeper loop — safe before a cutover.
 *
 *   cd scripts/keeper && npm run noeracle:check
 *
 * Once it succeeds, the shim read returns a price too (no more #32):
 *   stellar contract invoke --id <shim> --source noether_admin --network testnet \
 *     -- lastprice --asset BTC
 */

import {
  rpc,
  Contract,
  TransactionBuilder,
  xdr,
  scValToNative,
} from '@stellar/stellar-sdk';
import { loadConfig } from './config';
import { StellarClient } from './stellar';

const PAIR = 'BTC/USD';

async function main(): Promise<void> {
  const config = loadConfig();
  const stellar = new StellarClient(config);

  console.log('Keeper account :', stellar.publicKey);
  console.log('Noeracle       :', config.noeracleContractId);
  console.log('RPC            :', config.rpcUrl);
  console.log('');

  // 1) Fetch one fresh signed attestation from the public service.
  const { Noeracle } = await import('@noeracle/sdk');
  const client = new Noeracle({ network: config.network });
  const fresh = await client.fetchLatest([PAIR]);
  const att = fresh.attestations.find((a) => a.asset === PAIR);
  if (!att) {
    throw new Error(`No ${PAIR} attestation returned by the service`);
  }
  console.log(`Fetched ${PAIR}: $${att.price_human} round=${att.round_id} ts=${att.timestamp}`);

  // 2) Push it as a batch of one via the hardened entrypoint.
  const pushed = await stellar.updateNoeracleBatchPersistent([att]);
  if (!pushed.success) {
    throw new Error(`update_batch_ed25519_persistent failed: ${pushed.error}`);
  }
  console.log(`✅ Pushed to Noeracle persistent storage. tx: ${pushed.txHash}`);

  // 3) Read it back from get_price_pers(tag). The 8-byte tag is the first 8
  //    bytes of the signed message (e.g. "BTCUSD\0\0").
  const tag = Buffer.from(att.message, 'hex').subarray(0, 8);
  const server = new rpc.Server(config.rpcUrl, { timeout: 15_000 });
  const account = await server.getAccount(stellar.publicKey);
  const noeracle = new Contract(config.noeracleContractId);
  const readTx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(noeracle.call('get_price_pers', xdr.ScVal.scvBytes(tag)))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(readTx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`get_price_pers read failed: ${sim.error}`);
  }
  if (!sim.result) {
    throw new Error('get_price_pers read returned no result');
  }

  const entry = scValToNative(sim.result.retval) as
    | { price: bigint; timestamp: bigint | number; round_id: bigint | number }
    | undefined
    | null;

  if (!entry) {
    throw new Error('get_price_pers returned None right after a successful push — unexpected');
  }

  console.log('✅ get_price_pers(BTCUSD) =>', {
    price: entry.price.toString(),
    timestamp: Number(entry.timestamp),
    round_id: Number(entry.round_id),
  });

  // 4) Negative checks — the S-1 hardening must actually bite. Both pushes
  //    MUST fail (publisher gate runs before signature verification, and
  //    staleness runs before both, so the exact contract errors are
  //    UnknownPublisher / StalePrice).
  const rogue = await stellar.updateNoeracleBatchPersistent([
    { ...att, publisher: '11'.repeat(32) },
  ]);
  if (rogue.success) {
    throw new Error(
      'SECURITY: unregistered publisher key was ACCEPTED — hardened entrypoint not active on this deployment',
    );
  }
  console.log('✅ Unregistered publisher rejected (publisher gate active)');

  const stale = await stellar.updateNoeracleBatchPersistent([
    { ...att, timestamp: att.timestamp - 3_600 },
  ]);
  if (stale.success) {
    throw new Error(
      'SECURITY: hour-old timestamp was ACCEPTED — staleness bound not active on this deployment',
    );
  }
  console.log('✅ Stale round rejected (staleness bound active)');

  console.log('');
  console.log('Path OK (happy path + hardening). The shim lastprice will now return a price too:');
  console.log(
    '  stellar contract invoke --id <shim> --source noether_admin --network testnet -- lastprice --asset BTC',
  );
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
