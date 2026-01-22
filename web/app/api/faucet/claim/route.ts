import { NextRequest, NextResponse } from 'next/server';
import {
  Horizon,
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  Networks,
  StrKey,
} from '@stellar/stellar-sdk';
import {
  getClaimHistory,
  getRemainingAllowance,
  hasTrustline,
  CLAIM_AMOUNTS,
  ClaimAmount,
} from '@/lib/stellar/faucet';
import { NETWORK } from '@/lib/utils/constants';

const USDC_ISSUER = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';
const USDC_ASSET = new Asset('USDC', USDC_ISSUER);

export async function POST(request: NextRequest) {
  try {
    const { address, amount } = await request.json();

    // Validate address
    if (!address) {
      return NextResponse.json(
        { success: false, error: 'Address is required' },
        { status: 400 }
      );
    }

    if (!StrKey.isValidEd25519PublicKey(address)) {
      return NextResponse.json(
        { success: false, error: 'Invalid Stellar address' },
        { status: 400 }
      );
    }

    // Validate amount
    if (!CLAIM_AMOUNTS.includes(amount as ClaimAmount)) {
      return NextResponse.json(
        { success: false, error: 'Invalid amount. Choose 100, 500, or 1000 USDC.' },
        { status: 400 }
      );
    }

    // Check admin key is configured
    const adminSecretKey = process.env.ADMIN_SECRET_KEY;
    if (!adminSecretKey) {
      console.error('ADMIN_SECRET_KEY not configured');
      return NextResponse.json(
        { success: false, error: 'Faucet not configured' },
        { status: 500 }
      );
    }

    // Check trustline
    const hasTrust = await hasTrustline(address);
    if (!hasTrust) {
      return NextResponse.json(
        { success: false, error: 'USDC trustline not found. Please add trustline first.' },
        { status: 400 }
      );
    }

    // Check daily limit
    const history = await getClaimHistory(address);
    const remaining = getRemainingAllowance(history);

    if (amount > remaining) {
      return NextResponse.json(
        {
          success: false,
          error: `Daily limit exceeded. You can claim up to ${remaining} USDC today.`,
          remaining,
        },
        { status: 400 }
      );
    }

    // Build and submit payment transaction
    const horizonServer = new Horizon.Server(NETWORK.HORIZON_URL);
    const issuerKeypair = Keypair.fromSecret(adminSecretKey);
    const issuerAccount = await horizonServer.loadAccount(issuerKeypair.publicKey());

    const transaction = new TransactionBuilder(issuerAccount, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: address,
          asset: USDC_ASSET,
          amount: amount.toString(),
        })
      )
      .setTimeout(30)
      .build();

    transaction.sign(issuerKeypair);

    const result = await horizonServer.submitTransaction(transaction);

    // Calculate new remaining
    const newRemaining = remaining - amount;

    return NextResponse.json({
      success: true,
      txHash: result.hash,
      amount,
      remaining: newRemaining,
      message: `Successfully received ${amount} USDC`,
    });
  } catch (error) {
    console.error('Faucet claim error:', error);

    // Handle specific Horizon errors
    if (error instanceof Error) {
      const message = error.message;

      if (message.includes('op_no_trust')) {
        return NextResponse.json(
          { success: false, error: 'USDC trustline not found. Please add trustline first.' },
          { status: 400 }
        );
      }

      if (message.includes('op_line_full')) {
        return NextResponse.json(
          { success: false, error: 'Your USDC trustline limit is full.' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Failed to process claim. Please try again.' },
      { status: 500 }
    );
  }
}
