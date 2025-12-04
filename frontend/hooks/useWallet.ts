"use client";

import { useState, useEffect, useCallback } from "react";
import {
  isConnected as checkIsConnectedApi,
  getAddress,
  signTransaction,
  isAllowed as checkIsAllowedApi,
  requestAccess,
  getNetworkDetails,
} from "@stellar/freighter-api";

export type StellarNetwork = "testnet" | "futurenet" | "mainnet" | "unknown";

export interface WalletState {
  isConnected: boolean;
  isLoading: boolean;
  address: string | null;
  network: StellarNetwork;
  networkPassphrase: string | null;
  error: string | null;
}

export interface UseWalletReturn extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  signTx: (xdr: string, networkPassphrase?: string) => Promise<string>;
  refreshNetwork: () => Promise<void>;
}

// Network passphrase mapping
const NETWORK_PASSPHRASES: Record<string, StellarNetwork> = {
  "Test SDF Network ; September 2015": "testnet",
  "Test SDF Future Network ; October 2022": "futurenet",
  "Public Global Stellar Network ; September 2015": "mainnet",
};

function getNetworkFromPassphrase(passphrase: string): StellarNetwork {
  return NETWORK_PASSPHRASES[passphrase] || "unknown";
}

export function useWallet(): UseWalletReturn {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    isLoading: true,
    address: null,
    network: "unknown",
    networkPassphrase: null,
    error: null,
  });

  // Fetch network details
  const fetchNetworkDetails = useCallback(async () => {
    try {
      const { networkPassphrase, error } = await getNetworkDetails();
      if (!error && networkPassphrase) {
        const network = getNetworkFromPassphrase(networkPassphrase);
        setState((prev) => ({
          ...prev,
          network,
          networkPassphrase,
        }));
        return { network, networkPassphrase };
      }
    } catch (err) {
      console.warn("Could not fetch network details:", err);
    }
    return null;
  }, []);

  // Check if wallet is already connected on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const { isConnected: connected } = await checkIsConnectedApi();

        if (connected) {
          const { isAllowed: allowed } = await checkIsAllowedApi();
          if (allowed) {
            const { address } = await getAddress();
            const networkInfo = await fetchNetworkDetails();

            setState({
              isConnected: true,
              isLoading: false,
              address: address,
              network: networkInfo?.network || "testnet",
              networkPassphrase: networkInfo?.networkPassphrase || "Test SDF Network ; September 2015",
              error: null,
            });
            return;
          }
        }

        setState((prev) => ({ ...prev, isLoading: false }));
      } catch (error) {
        console.error("Error checking wallet connection:", error);
        setState({
          isConnected: false,
          isLoading: false,
          address: null,
          network: "unknown",
          networkPassphrase: null,
          error: "Failed to check wallet connection",
        });
      }
    };

    checkConnection();
  }, [fetchNetworkDetails]);

  // Connect wallet
  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Check if Freighter is installed
      const { isConnected: connected } = await checkIsConnectedApi();

      if (!connected) {
        throw new Error(
          "Freighter wallet is not installed. Please install it from freighter.app"
        );
      }

      // Request access - this will prompt the user to allow the connection
      const { address, error } = await requestAccess();

      if (error) {
        throw new Error(error);
      }

      // Get network details after connection
      const networkInfo = await fetchNetworkDetails();

      setState({
        isConnected: true,
        isLoading: false,
        address: address,
        network: networkInfo?.network || "testnet",
        networkPassphrase: networkInfo?.networkPassphrase || "Test SDF Network ; September 2015",
        error: null,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to connect wallet";
      setState({
        isConnected: false,
        isLoading: false,
        address: null,
        network: "unknown",
        networkPassphrase: null,
        error: errorMessage,
      });
      throw error;
    }
  }, [fetchNetworkDetails]);

  // Disconnect wallet (just clear local state - Freighter doesn't have a disconnect)
  const disconnect = useCallback(() => {
    setState({
      isConnected: false,
      isLoading: false,
      address: null,
      network: "unknown",
      networkPassphrase: null,
      error: null,
    });
  }, []);

  // Sign a transaction
  const signTx = useCallback(
    async (xdr: string, networkPassphrase?: string): Promise<string> => {
      if (!state.isConnected) {
        throw new Error("Wallet not connected");
      }

      try {
        const passphrase = networkPassphrase || state.networkPassphrase || "Test SDF Network ; September 2015";

        const { signedTxXdr, error } = await signTransaction(xdr, {
          networkPassphrase: passphrase,
          address: state.address || undefined,
        });

        if (error) {
          throw new Error(error);
        }

        return signedTxXdr;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to sign transaction";
        throw new Error(errorMessage);
      }
    },
    [state.isConnected, state.address, state.networkPassphrase]
  );

  // Refresh network details
  const refreshNetwork = useCallback(async () => {
    await fetchNetworkDetails();
  }, [fetchNetworkDetails]);

  return {
    ...state,
    connect,
    disconnect,
    signTx,
    refreshNetwork,
  };
}

// Format address for display (truncate middle)
export function formatAddress(
  address: string | null,
  chars: number = 4
): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
