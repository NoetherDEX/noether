import { NextResponse } from "next/server";

// Cache for 60 seconds
export const revalidate = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = searchParams.get("days") || "7";

    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=${days}`,
      {
        headers: {
          "Accept": "application/json",
        },
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "CoinGecko API error" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("BTC OHLC API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch BTC OHLC data" },
      { status: 500 }
    );
  }
}
