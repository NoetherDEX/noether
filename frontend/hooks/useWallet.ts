"use client";

import { useState, useEffect, useCallback } from "react";
import {
  isConnected as checkIsConnectedApi,
  getAddress,
  signTransaction,
  isAllowed as checkIsAllowedApi,
  requestAccess,
} from "@stellar/freighter-api";

export interface WalletState {
  isConnected: boolean;
  isLoading: boolean;
  address: string | null;
  error: string | null;
}

export interface UseWalletReturn extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  signTx: (xdr: string, networkPassphrase: string) => Promise<string>;
}

export function useWallet(): UseWalletReturn {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    isLoading: true,
    address: null,
    error: null,
  });

  // Check if wallet is already connected on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const { isConnected: connected } = await checkIsConnectedApi();

        if (connected) {
          const { isAllowed: allowed } = await checkIsAllowedApi();
          if (allowed) {
            const { address } = await getAddress();
            setState({
              isConnected: true,
              isLoading: false,
              address: address,
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
          error: "Failed to check wallet connection",
        });
      }
    };

    checkConnection();
  }, []);

  // Connect wallet
  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Check if Freighter is installed
      const { isConnected: connected } = await checkIsConnectedApi();

      if (!connected) {
        throw new Error("Freighter wallet is not installed. Please install it from freighter.app");
      }

      // Request access - this will prompt the user to allow the connection
      const { address, error } = await requestAccess();

      if (error) {
        throw new Error(error);
      }

      setState({
        isConnected: true,
        isLoading: false,
        address: address,
        error: null,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to connect wallet";
      setState({
        isConnected: false,
        isLoading: false,
        address: null,
        error: errorMessage,
      });
      throw error;
    }
  }, []);

  // Disconnect wallet (just clear local state - Freighter doesn't have a disconnect)
  const disconnect = useCallback(() => {
    setState({
      isConnected: false,
      isLoading: false,
      address: null,
      error: null,
    });
  }, []);

  // Sign a transaction
  const signTx = useCallback(
    async (xdr: string, networkPassphrase: string): Promise<string> => {
      if (!state.isConnected) {
        throw new Error("Wallet not connected");
      }

      try {
        const { signedTxXdr, error } = await signTransaction(xdr, {
          networkPassphrase,
          address: state.address || undefined,
        });

        if (error) {
          throw new Error(error);
        }

        return signedTxXdr;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to sign transaction";
        throw new Error(errorMessage);
      }
    },
    [state.isConnected, state.address]
  );

  return {
    ...state,
    connect,
    disconnect,
    signTx,
  };
}

// Format address for display (truncate middle)
export function formatAddress(address: string | null, chars: number = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
