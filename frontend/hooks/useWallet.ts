"use client";

import { useState, useEffect, useCallback } from "react";
import {
  isConnected as checkIsConnected,
  getPublicKey,
  signTransaction,
  isAllowed,
  setAllowed,
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
  signTx: (xdr: string, network: string, networkPassphrase: string) => Promise<string>;
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
        const connected = await checkIsConnected();
        
        if (connected) {
          const allowed = await isAllowed();
          if (allowed) {
            const publicKey = await getPublicKey();
            setState({
              isConnected: true,
              isLoading: false,
              address: publicKey,
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
      const connected = await checkIsConnected();
      
      if (!connected) {
        throw new Error("Freighter wallet is not installed. Please install it from freighter.app");
      }

      // Request permission to access the wallet
      await setAllowed();
      
      // Get the public key
      const publicKey = await getPublicKey();

      setState({
        isConnected: true,
        isLoading: false,
        address: publicKey,
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
    async (xdr: string, network: string, networkPassphrase: string): Promise<string> => {
      if (!state.isConnected) {
        throw new Error("Wallet not connected");
      }

      try {
        const result = await signTransaction(xdr, {
          network,
          networkPassphrase,
        });
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to sign transaction";
        throw new Error(errorMessage);
      }
    },
    [state.isConnected]
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


