import { NextRequest, NextResponse } from 'next/server';
import { mintTestUSDC } from '@/lib/stellar/token';
import { TRADING, NETWORK } from '@/lib/utils/constants';

// Amount to mint: 10,000 USDC (with 7 decimals)
const MINT_AMOUNT = BigInt(10_000 * TRADING.PRECISION);

export async function POST(request: NextRequest) {
  try {
    // Fail-closed: the faucet mints TEST assets and must NEVER run on mainnet.
    // It operates only when the network is explicitly testnet, so flipping the
    // network constant to mainnet auto-disables it (P6-3 / config-parity).
    if ((NETWORK.NAME as string) !== 'testnet') {
      return NextResponse.json(
        { error: 'Faucet is disabled outside testnet.' },
        { status: 403 }
      );
    }

    const { recipientAddress } = await request.json();

    if (!recipientAddress) {
      return NextResponse.json(
        { error: 'Recipient address is required' },
        { status: 400 }
      );
    }

    // Validate address format (Stellar public keys start with G)
    if (!recipientAddress.startsWith('G') || recipientAddress.length !== 56) {
      return NextResponse.json(
        { error: 'Invalid Stellar address format' },
        { status: 400 }
      );
    }

    const adminSecretKey = process.env.ADMIN_SECRET_KEY;

    if (!adminSecretKey) {
      console.error('ADMIN_SECRET_KEY not configured');
      return NextResponse.json(
        { error: 'Faucet not configured. Please set ADMIN_SECRET_KEY.' },
        { status: 500 }
      );
    }

    // Mint test USDC
    const txHash = await mintTestUSDC(adminSecretKey, recipientAddress, MINT_AMOUNT);

    return NextResponse.json({
      success: true,
      amount: 10_000,
      txHash,
      message: `Successfully minted 10,000 test USDC to ${recipientAddress.slice(0, 8)}...`,
    });
  } catch (error) {
    console.error('Faucet error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to mint test USDC' },
      { status: 500 }
    );
  }
}
