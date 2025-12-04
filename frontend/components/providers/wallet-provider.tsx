"use client";

import React, { createContext, useContext, ReactNode } from "react";
import { useWallet, UseWalletReturn, formatAddress, StellarNetwork } from "@/hooks/useWallet";

// Extended context type with formatAddress utility
interface WalletContextType extends UseWalletReturn {
  formatAddr: (chars?: number) => string;
}

// Create context with undefined default
const WalletContext = createContext<WalletContextType | undefined>(undefined);

// Provider component
export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();

  // Utility to format the current address
  const formatAddr = (chars: number = 4) => formatAddress(wallet.address, chars);

  return (
    <WalletContext.Provider value={{ ...wallet, formatAddr }}>
      {children}
    </WalletContext.Provider>
  );
}

// Hook to use wallet context
export function useWalletContext(): WalletContextType {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWalletContext must be used within a WalletProvider");
  }
  return context;
}

// Re-export types and utilities
export { formatAddress };
export type { StellarNetwork };
