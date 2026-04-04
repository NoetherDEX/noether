export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

// Try multiple Binance endpoints - different ones work from different regions
const BINANCE_ENDPOINTS = [
  'https://api.binance.us/api/v3',    // Works from US (Vercel servers)
  'https://api4.binance.com/api/v3',   // Alternative global endpoint
  'https://api1.binance.com/api/v3',   // Another alternative
  'https://api.binance.com/api/v3',    // Main global (blocked from US)
];

async function fetchWithFallback(path: string): Promise<Response> {
  let lastError: Error | null = null;

  for (const base of BINANCE_ENDPOINTS) {
    try {
      const response = await fetch(`${base}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return response;
      }

      // 451 = geo-blocked, try next endpoint
      if (response.status === 451 || response.status === 403) {
        continue;
      }

      return response; // Other errors, return as-is
    } catch (e) {
      lastError = e as Error;
      continue;
    }
  }

  throw lastError || new Error('All Binance endpoints failed');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get('endpoint');
  const symbol = searchParams.get('symbol');
  const interval = searchParams.get('interval');
  const limit = searchParams.get('limit');

  if (!endpoint || !symbol) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  try {
    let path = '';
    if (endpoint === 'klines') {
      path = `/klines?symbol=${symbol}&interval=${interval || '1h'}&limit=${limit || '500'}`;
    } else if (endpoint === 'ticker') {
      path = `/ticker/24hr?symbol=${symbol}`;
    } else if (endpoint === 'price') {
      path = `/ticker/price?symbol=${symbol}`;
    } else {
      return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
    }

    const response = await fetchWithFallback(path);

    if (!response.ok) {
      return NextResponse.json(
        { error: `API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10',
      },
    });
  } catch (error) {
    console.error('Price proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch price data' }, { status: 500 });
  }
}
