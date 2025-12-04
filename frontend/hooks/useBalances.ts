"use client";

import { useState, useEffect, useCallback } from "react";
import { Horizon } from "@stellar/stellar-sdk";
import { useWalletContext, StellarNetwork } from "@/components/providers/wallet-provider";

// Horizon server URLs for different networks
const HORIZON_URLS: Record<StellarNetwork, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
  mainnet: "https://horizon.stellar.org",
  unknown: "https://horizon-testnet.stellar.org",
};

// Known USDC issuers on different networks (Testnet uses Circle's test issuer)
const USDC_ISSUERS: Record<StellarNetwork, string> = {
  testnet: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", // Circle testnet USDC
  futurenet: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mainnet: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", // Circle mainnet USDC
  unknown: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

export interface BalanceInfo {
  asset: string;
  balance: string;
  balanceNum: number;
  issuer?: string;
}

export interface Balances {
  xlm: BalanceInfo;
  usdc: BalanceInfo | null;
  all: BalanceInfo[];
  totalUsdValue: number;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

export interface UseBalancesReturn extends Balances {
  refresh: () => Promise<void>;
  fundWithFriendbot: () => Promise<boolean>;
}

// Format balance for display
function formatBalance(balance: string | number, decimals: number = 2): string {
  const num = typeof balance === "string" ? parseFloat(balance) : balance;
  if (isNaN(num)) return "0.00";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// XLM price in USD (we'll use a simple mock or could integrate a price feed)
const XLM_USD_PRICE = 0.45; // You could fetch this from an API

export function useBalances(): UseBalancesReturn {
  const { address, isConnected, network } = useWalletContext();

  const [balances, setBalances] = useState<Balances>({
    xlm: { asset: "XLM", balance: "0.00", balanceNum: 0 },
    usdc: null,
    all: [],
    totalUsdValue: 0,
    isLoading: false,
    error: null,
    lastUpdated: null,
  });

  // Fetch balances from Horizon
  const fetchBalances = useCallback(async () => {
    if (!address || !isConnected) {
      setBalances((prev) => ({
        ...prev,
        xlm: { asset: "XLM", balance: "0.00", balanceNum: 0 },
        usdc: null,
        all: [],
        totalUsdValue: 0,
        isLoading: false,
        error: null,
      }));
      return;
    }

    setBalances((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const horizonUrl = HORIZON_URLS[network] || HORIZON_URLS.testnet;
      const server = new Horizon.Server(horizonUrl);

      // Load account from Horizon
      const account = await server.loadAccount(address);

      const allBalances: BalanceInfo[] = [];
      let xlmBalance: BalanceInfo = { asset: "XLM", balance: "0.00", balanceNum: 0 };
      let usdcBalance: BalanceInfo | null = null;
      let totalUsdValue = 0;

      // Parse balances
      for (const balance of account.balances) {
        if (balance.asset_type === "native") {
          // XLM (native asset)
          const balanceNum = parseFloat(balance.balance);
          xlmBalance = {
            asset: "XLM",
            balance: formatBalance(balance.balance),
            balanceNum,
          };
          allBalances.push(xlmBalance);
          totalUsdValue += balanceNum * XLM_USD_PRICE;
        } else if (balance.asset_type === "credit_alphanum4" || balance.asset_type === "credit_alphanum12") {
          // Credit asset (like USDC)
          const balanceNum = parseFloat(balance.balance);
          const assetInfo: BalanceInfo = {
            asset: balance.asset_code,
            balance: formatBalance(balance.balance),
            balanceNum,
            issuer: balance.asset_issuer,
          };
          allBalances.push(assetInfo);

          // Check if it's USDC
          const usdcIssuer = USDC_ISSUERS[network] || USDC_ISSUERS.testnet;
          if (
            balance.asset_code === "USDC" &&
            balance.asset_issuer === usdcIssuer
          ) {
            usdcBalance = assetInfo;
            totalUsdValue += balanceNum; // USDC is 1:1 with USD
          }
        }
      }

      setBalances({
        xlm: xlmBalance,
        usdc: usdcBalance,
        all: allBalances,
        totalUsdValue,
        isLoading: false,
        error: null,
        lastUpdated: new Date(),
      });
    } catch (error: unknown) {
      // Handle 404 error (account not found / not funded)
      const horizonError = error as { response?: { status?: number } };
      if (horizonError?.response?.status === 404) {
        setBalances({
          xlm: { asset: "XLM", balance: "0.00", balanceNum: 0 },
          usdc: null,
          all: [],
          totalUsdValue: 0,
          isLoading: false,
          error: "Account not funded. Use Friendbot to get testnet XLM.",
          lastUpdated: new Date(),
        });
      } else {
        console.error("Error fetching balances:", error);
        setBalances((prev) => ({
          ...prev,
          isLoading: false,
          error: "Failed to fetch balances. Please try again.",
          lastUpdated: new Date(),
        }));
      }
    }
  }, [address, isConnected, network]);

  // Fund account with Friendbot (testnet/futurenet only)
  const fundWithFriendbot = useCallback(async (): Promise<boolean> => {
    if (!address) return false;

    if (network !== "testnet" && network !== "futurenet") {
      console.warn("Friendbot is only available on testnet and futurenet");
      return false;
    }

    try {
      const friendbotUrl =
        network === "futurenet"
          ? `https://friendbot-futurenet.stellar.org?addr=${address}`
          : `https://friendbot.stellar.org?addr=${address}`;

      const response = await fetch(friendbotUrl);

      if (response.ok) {
        // Refresh balances after funding
        await fetchBalances();
        return true;
      }

      return false;
    } catch (error) {
      console.error("Friendbot funding failed:", error);
      return false;
    }
  }, [address, network, fetchBalances]);

  // Fetch balances when address changes
  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  // Auto-refresh every 30 seconds when connected
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(fetchBalances, 30000);
    return () => clearInterval(interval);
  }, [isConnected, fetchBalances]);

  return {
    ...balances,
    refresh: fetchBalances,
    fundWithFriendbot,
  };
}

// Export utility functions
export { formatBalance };
