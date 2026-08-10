import { describe, expect, it } from 'vitest';
import {
  Account,
  BASE_FEE,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { RESOURCE_MARGIN, withResourceHeadroom } from '../src/client.js';

/**
 * Build a transaction that already carries soroban data, standing in for the
 * output of rpc.assembleTransaction. The envelope fee has to equal the
 * inclusion fee plus the resource fee, which is what the real assembler emits.
 */
function assembled(resourceFee: bigint, instructions = 1_000_000, readBytes = 500, writeBytes = 3656) {
  const account = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '1');
  const data = new SorobanDataBuilder()
    .setResources(instructions, readBytes, writeBytes)
    .setResourceFee(resourceFee)
    .build();
  // Pass only the inclusion fee. build() adds the resource fee itself, which
  // is exactly what rpc.assembleTransaction produces, so the resulting
  // envelope fee is inclusion + resource counted once.
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(Buffer.alloc(1)),
        auth: [],
      }),
    )
    .setSorobanData(data)
    .setTimeout(60)
    .build();
}

function sorobanOf(tx: ReturnType<typeof assembled>) {
  return tx.toEnvelope().v1().tx().ext().sorobanData()!;
}

describe('withResourceHeadroom', () => {
  it('widens every declared resource by the margin', () => {
    const out = withResourceHeadroom(assembled(1_000_000n));
    const res = sorobanOf(out).resources();
    expect(res.instructions()).toBe(Math.ceil(1_000_000 * RESOURCE_MARGIN));
    expect(res.diskReadBytes()).toBe(Math.ceil(500 * RESOURCE_MARGIN));
    // writeBytes is the one an unrelated trader's activity grows, which is
    // what made a zero slack declaration fail.
    expect(res.writeBytes()).toBe(Math.ceil(3656 * RESOURCE_MARGIN));
    expect(BigInt(sorobanOf(out).resourceFee().toString())).toBe(1_250_000n);
  });

  it('counts the resource fee once, not twice', () => {
    const resourceFee = 26_462_068n;
    const before = assembled(resourceFee);
    const after = withResourceHeadroom(before);

    const inflated = BigInt(Math.ceil(Number(resourceFee) * RESOURCE_MARGIN));
    const expected = BigInt(BASE_FEE) + inflated;

    // The regression: passing base plus resource as the builder fee made build
    // add the resource fee a second time, so the wallet was shown roughly two
    // and a half times the real cost.
    expect(BigInt(after.fee)).toBe(expected);
    expect(BigInt(after.fee)).toBeLessThan(BigInt(BASE_FEE) + inflated * 2n);
  });

  it('leaves a transaction without soroban data untouched', () => {
    const account = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '1');
    const plain = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
      .setTimeout(60)
      .build();
    expect(withResourceHeadroom(plain).fee).toBe(plain.fee);
  });
});
