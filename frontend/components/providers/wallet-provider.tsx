"use client";

import React, { createContext, useContext, ReactNode } from "react";
import { useWallet, UseWalletReturn, formatAddress } from "@/hooks/useWallet";

// Create context with undefined default
const WalletContext = createContext<UseWalletReturn | undefined>(undefined);

// Provider component
export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  
  return (
    <WalletContext.Provider value={wallet}>
      {children}
    </WalletContext.Provider>
  );
}

// Hook to use wallet context
export function useWalletContext(): UseWalletReturn {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWalletContext must be used within a WalletProvider");
  }
  return context;
}

// Re-export formatAddress for convenience
export { formatAddress };


