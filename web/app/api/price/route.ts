export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const BINANCE_API = 'https://api.binance.com/api/v3';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get('endpoint'); // 'klines' or 'ticker'
  const symbol = searchParams.get('symbol');
  const interval = searchParams.get('interval');
  const limit = searchParams.get('limit');

  if (!endpoint || !symbol) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  try {
    let url = '';
    if (endpoint === 'klines') {
      url = `${BINANCE_API}/klines?symbol=${symbol}&interval=${interval || '1h'}&limit=${limit || '500'}`;
    } else if (endpoint === 'ticker') {
      url = `${BINANCE_API}/ticker/24hr?symbol=${symbol}`;
    } else if (endpoint === 'price') {
      url = `${BINANCE_API}/ticker/price?symbol=${symbol}`;
    } else {
      return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'NoetherDEX/1.0' },
      next: { revalidate: 5 }, // cache 5 seconds
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Binance API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Price proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch price data' }, { status: 500 });
  }
}
