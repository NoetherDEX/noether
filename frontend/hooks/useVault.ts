"use client";

import { useState, useCallback } from "react";
import { useWallet } from "./useWallet";
import { CONTRACTS, NETWORK, toContractAmount } from "@/lib/contracts";

export interface VaultStats {
  totalValueLocked: number;
  totalShares: number;
  sharePrice: number;
  apy: number;
}

export interface UserVaultPosition {
  shares: number;
  depositedAmount: number;
  currentValue: number;
  pnl: number;
}

export interface UseVaultReturn {
  isLoading: boolean;
  error: string | null;
  depositLiquidity: (amount: number) => Promise<string | null>;
  withdrawLiquidity: (shares: number) => Promise<string | null>;
  getVaultStats: () => Promise<VaultStats | null>;
  getUserPosition: () => Promise<UserVaultPosition | null>;
}

// Lazy load Stellar SDK to avoid SSR issues
async function getStellarSdk() {
  const sdk = await import("@stellar/stellar-sdk");
  return sdk;
}

export function useVault(): UseVaultReturn {
  const { address, signTx, isConnected } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deposit liquidity into the vault
  const depositLiquidity = useCallback(
    async (amount: number): Promise<string | null> => {
      if (!address || !isConnected) {
        setError("Wallet not connected");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const {
          Contract,
          SorobanRpc,
          TransactionBuilder,
          BASE_FEE,
          Address,
          nativeToScVal,
        } = await getStellarSdk();

        const server = new SorobanRpc.Server(NETWORK.rpcUrl);
        const contract = new Contract(CONTRACTS.VAULT);

        // Convert to contract amount (7 decimals)
        const depositAmount = toContractAmount(amount);

        // Build the deposit operation
        const operation = contract.call(
          "deposit",
          new Address(address).toScVal(),
          nativeToScVal(depositAmount, { type: "i128" })
        );

        // Load account
        const account = await server.getAccount(address);

        // Build transaction
        const transaction = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: NETWORK.passphrase,
        })
          .addOperation(operation)
          .setTimeout(30)
          .build();

        // Simulate
        const simulated = await server.simulateTransaction(transaction);

        if (SorobanRpc.Api.isSimulationError(simulated)) {
          throw new Error(`Simulation failed: ${simulated.error}`);
        }

        // Prepare and sign
        const prepared = SorobanRpc.assembleTransaction(
          transaction,
          simulated
        ).build();
        const signedXdr = await signTx(
          prepared.toXDR(),
          NETWORK.passphrase
        );

        // Submit
        const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK.passphrase);
        const result = await server.sendTransaction(tx);

        if (result.status === "ERROR") {
          throw new Error("Transaction submission failed");
        }

        // Wait for confirmation
        let getResponse = await server.getTransaction(result.hash);
        while (getResponse.status === "NOT_FOUND") {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          getResponse = await server.getTransaction(result.hash);
        }

        if (getResponse.status === "SUCCESS") {
          return result.hash;
        } else {
          throw new Error("Transaction failed");
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to deposit";
        setError(errorMessage);
        console.error("Deposit error:", err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [address, isConnected, signTx]
  );

  // Withdraw liquidity from the vault
  const withdrawLiquidity = useCallback(
    async (shares: number): Promise<string | null> => {
      if (!address || !isConnected) {
        setError("Wallet not connected");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const {
          Contract,
          SorobanRpc,
          TransactionBuilder,
          BASE_FEE,
          Address,
          nativeToScVal,
        } = await getStellarSdk();

        const server = new SorobanRpc.Server(NETWORK.rpcUrl);
        const contract = new Contract(CONTRACTS.VAULT);

        // Convert to contract amount (7 decimals)
        const shareAmount = toContractAmount(shares);

        // Build the withdraw operation
        const operation = contract.call(
          "withdraw",
          new Address(address).toScVal(),
          nativeToScVal(shareAmount, { type: "i128" })
        );

        // Load account
        const account = await server.getAccount(address);

        // Build transaction
        const transaction = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: NETWORK.passphrase,
        })
          .addOperation(operation)
          .setTimeout(30)
          .build();

        // Simulate
        const simulated = await server.simulateTransaction(transaction);

        if (SorobanRpc.Api.isSimulationError(simulated)) {
          throw new Error(`Simulation failed: ${simulated.error}`);
        }

        // Prepare and sign
        const prepared = SorobanRpc.assembleTransaction(
          transaction,
          simulated
        ).build();
        const signedXdr = await signTx(
          prepared.toXDR(),
          NETWORK.passphrase
        );

        // Submit
        const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK.passphrase);
        const result = await server.sendTransaction(tx);

        if (result.status === "ERROR") {
          throw new Error("Transaction submission failed");
        }

        // Wait for confirmation
        let getResponse = await server.getTransaction(result.hash);
        while (getResponse.status === "NOT_FOUND") {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          getResponse = await server.getTransaction(result.hash);
        }

        if (getResponse.status === "SUCCESS") {
          return result.hash;
        } else {
          throw new Error("Transaction failed");
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to withdraw";
        setError(errorMessage);
        console.error("Withdraw error:", err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [address, isConnected, signTx]
  );

  // Get vault statistics (view function)
  const getVaultStats = useCallback(async (): Promise<VaultStats | null> => {
    try {
      // Return mock data for now - implement when contracts are deployed
      return {
        totalValueLocked: 1_250_000,
        totalShares: 1_200_000,
        sharePrice: 1.042,
        apy: 12.5,
      };
    } catch (err) {
      console.error("Get vault stats error:", err);
      return null;
    }
  }, []);

  // Get user's vault position (view function)
  const getUserPosition =
    useCallback(async (): Promise<UserVaultPosition | null> => {
      if (!address) {
        return null;
      }

      try {
        // Return mock data for now - implement when contracts are deployed
        return {
          shares: 8420.5,
          depositedAmount: 8000,
          currentValue: 8774.16,
          pnl: 774.16,
        };
      } catch (err) {
        console.error("Get user position error:", err);
        return null;
      }
    }, [address]);

  return {
    isLoading,
    error,
    depositLiquidity,
    withdrawLiquidity,
    getVaultStats,
    getUserPosition,
  };
}
