"use client";

import { useState, useEffect, useCallback } from "react";
import { CONTRACTS, NETWORK, fromContractAmount } from "@/lib/contracts";

export interface PriceData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isGreen: boolean;
}

export interface CurrentPrice {
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  lastUpdated: Date;
}

interface CoinGeckoOHLC {
  0: number; // timestamp
  1: number; // open
  2: number; // high
  3: number; // low
  4: number; // close
}

interface CoinGeckoMarket {
  current_price: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  high_24h: number;
  low_24h: number;
  total_volume: number;
  last_updated: string;
}

// Lazy load Stellar SDK
async function getStellarSdk() {
  const sdk = await import("@stellar/stellar-sdk");
  return sdk;
}

/**
 * Fetch current price from our Oracle contract on Stellar
 */
export async function fetchOraclePrice(asset: "Stellar" | "USDC"): Promise<number | null> {
  try {
    const { Contract, SorobanRpc, TransactionBuilder, Keypair, BASE_FEE, nativeToScVal } = await getStellarSdk();

    const server = new SorobanRpc.Server(NETWORK.rpcUrl);
    const contract = new Contract(CONTRACTS.ORACLE);

    // Build asset enum
    const assetScVal = asset === "Stellar"
      ? nativeToScVal({ Stellar: null }, { type: { Stellar: null } })
      : nativeToScVal({ USDC: null }, { type: { USDC: null } });

    // Create a temporary keypair for simulation (read-only, no signing needed)
    const tempKeypair = Keypair.random();
    const account = await server.getAccount(tempKeypair.publicKey()).catch(() => null);

    if (!account) {
      // If we can't get an account, try simulating with a mock account
      console.warn("Cannot simulate oracle call without funded account");
      return null;
    }

    const operation = contract.call("get_price", assetScVal);

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.passphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simulated = await server.simulateTransaction(transaction);

    if (SorobanRpc.Api.isSimulationSuccess(simulated) && simulated.result) {
      // Parse the i128 result
      const price = fromContractAmount(BigInt(simulated.result.retval.value as string));
      return price;
    }

    return null;
  } catch (err) {
    console.error("Oracle price fetch error:", err);
    return null;
  }
}

/**
 * Fetch real BTC price data from CoinGecko via API route
 */
export async function fetchBTCPrice(): Promise<CurrentPrice | null> {
  try {
    const response = await fetch("/api/price/btc", {
      cache: "no-store", // Always fetch fresh data
    });

    if (!response.ok) {
      throw new Error("API error");
    }

    const data: CoinGeckoMarket[] = await response.json();

    if (data.length === 0) return null;

    const btc = data[0];
    return {
      price: btc.current_price,
      change24h: btc.price_change_24h,
      changePercent24h: btc.price_change_percentage_24h,
      high24h: btc.high_24h,
      low24h: btc.low_24h,
      volume24h: btc.total_volume,
      lastUpdated: new Date(btc.last_updated),
    };
  } catch (err) {
    console.error("BTC price fetch error:", err);
    return null;
  }
}

/**
 * Fetch historical OHLC data from CoinGecko via API route
 * @param days - Number of days of history (1, 7, 14, 30, 90, 180, 365, max)
 */
export async function fetchBTCOHLC(days: number = 7): Promise<PriceData[]> {
  try {
    const response = await fetch(
      `/api/price/btc/ohlc?days=${days}`,
      {
        cache: "no-store", // Always fetch fresh data
      }
    );

    if (!response.ok) {
      throw new Error("API error");
    }

    const data: CoinGeckoOHLC[] = await response.json();

    return data.map((candle) => {
      const [timestamp, open, high, low, close] = candle;
      const date = new Date(timestamp);

      // Format time based on days range
      let timeLabel: string;
      if (days <= 1) {
        timeLabel = `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
      } else if (days <= 7) {
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        timeLabel = `${dayNames[date.getDay()]} ${date.getHours()}:00`;
      } else if (days <= 30) {
        timeLabel = `${date.getMonth() + 1}/${date.getDate()}`;
      } else {
        timeLabel = `${date.getMonth() + 1}/${date.getDate()}`;
      }

      return {
        time: timeLabel,
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.floor(Math.random() * 500 + 100), // CoinGecko OHLC doesn't include volume
        isGreen: close >= open,
      };
    });
  } catch (err) {
    console.error("BTC OHLC fetch error:", err);
    return [];
  }
}

/**
 * Fetch XLM price and historical data via API route
 */
export async function fetchXLMPrice(): Promise<CurrentPrice | null> {
  try {
    const response = await fetch("/api/price/xlm", {
      cache: "no-store", // Always fetch fresh data
    });

    if (!response.ok) {
      throw new Error("API error");
    }

    const data: CoinGeckoMarket[] = await response.json();

    if (data.length === 0) return null;

    const xlm = data[0];
    return {
      price: xlm.current_price,
      change24h: xlm.price_change_24h,
      changePercent24h: xlm.price_change_percentage_24h,
      high24h: xlm.high_24h,
      low24h: xlm.low_24h,
      volume24h: xlm.total_volume,
      lastUpdated: new Date(xlm.last_updated),
    };
  } catch (err) {
    console.error("XLM price fetch error:", err);
    return null;
  }
}

export async function fetchXLMOHLC(days: number = 7): Promise<PriceData[]> {
  try {
    const response = await fetch(
      `/api/price/xlm/ohlc?days=${days}`,
      {
        cache: "no-store", // Always fetch fresh data
      }
    );

    if (!response.ok) {
      throw new Error("API error");
    }

    const data: CoinGeckoOHLC[] = await response.json();

    return data.map((candle) => {
      const [timestamp, open, high, low, close] = candle;
      const date = new Date(timestamp);

      let timeLabel: string;
      if (days <= 1) {
        timeLabel = `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
      } else if (days <= 7) {
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        timeLabel = `${dayNames[date.getDay()]} ${date.getHours()}:00`;
      } else {
        timeLabel = `${date.getMonth() + 1}/${date.getDate()}`;
      }

      return {
        time: timeLabel,
        open: Math.round(open * 10000) / 10000,
        high: Math.round(high * 10000) / 10000,
        low: Math.round(low * 10000) / 10000,
        close: Math.round(close * 10000) / 10000,
        volume: Math.floor(Math.random() * 500 + 100),
        isGreen: close >= open,
      };
    });
  } catch (err) {
    console.error("XLM OHLC fetch error:", err);
    return [];
  }
}

/**
 * React hook to get live price updates
 */
export function usePrice(coin: "bitcoin" | "stellar" = "bitcoin") {
  const [currentPrice, setCurrentPrice] = useState<CurrentPrice | null>(null);
  const [historicalData, setHistoricalData] = useState<PriceData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<number>(7); // days

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [priceResult, ohlcResult] = await Promise.all([
        coin === "bitcoin" ? fetchBTCPrice() : fetchXLMPrice(),
        coin === "bitcoin" ? fetchBTCOHLC(timeframe) : fetchXLMOHLC(timeframe),
      ]);

      if (priceResult) {
        setCurrentPrice(priceResult);
      }

      if (ohlcResult.length > 0) {
        setHistoricalData(ohlcResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch price data");
    } finally {
      setIsLoading(false);
    }
  }, [coin, timeframe]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return {
    currentPrice,
    historicalData,
    isLoading,
    error,
    timeframe,
    setTimeframe,
    refresh: fetchData,
  };
}
