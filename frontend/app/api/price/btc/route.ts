import { NextResponse } from "next/server";

// Cache for 30 seconds
export const revalidate = 30;

export async function GET() {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin&order=market_cap_desc&sparkline=false",
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
    console.error("BTC price API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch BTC price" },
      { status: 500 }
    );
  }
}
