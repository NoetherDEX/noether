export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { StrKey } from '@stellar/stellar-sdk';
import {
  getClaimHistory,
  getRemainingAllowance,
  getTotalAllTime,
  getTodaysClaims,
  hasTrustline,
} from '@/lib/stellar/faucet';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    if (!address) {
      return NextResponse.json(
        { error: 'Address parameter is required' },
        { status: 400 }
      );
    }

    if (!StrKey.isValidEd25519PublicKey(address)) {
      return NextResponse.json(
        { error: 'Invalid Stellar address' },
        { status: 400 }
      );
    }

    // Fetch data in parallel
    const [history, trustlineStatus] = await Promise.all([
      getClaimHistory(address, limit),
      hasTrustline(address),
    ]);

    const todaysClaims = getTodaysClaims(history);
    const claimedToday = todaysClaims.reduce((sum, c) => sum + c.amount, 0);
    const remainingToday = getRemainingAllowance(history);
    const totalAllTime = getTotalAllTime(history);

    return NextResponse.json({
      success: true,
      hasTrustline: trustlineStatus,
      records: history,
      claimedToday,
      remainingToday,
      totalAllTime,
      dailyLimit: 1000,
    });
  } catch (error) {
    console.error('Faucet history error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch claim history' },
      { status: 500 }
    );
  }
}
