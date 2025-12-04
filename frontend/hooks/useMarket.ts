"use client";

import { useState, useCallback, useRef } from "react";
import { useWallet } from "./useWallet";
import { CONTRACTS, NETWORK, toContractAmount } from "@/lib/contracts";

// Position type matching our contract
export interface Position {
  owner: string;
  collateral: bigint;
  size: bigint;
  entryPrice: bigint;
  liquidationPrice: bigint;
}

export interface UseMarketReturn {
  isLoading: boolean;
  error: string | null;
  openPosition: (
    collateral: number,
    size: number,
    isLong: boolean
  ) => Promise<string | null>;
  closePosition: (asset: "Stellar" | "USDC") => Promise<string | null>;
  getPosition: (asset: "Stellar" | "USDC") => Promise<Position | null>;
}

// Lazy load Stellar SDK to avoid SSR issues
async function getStellarSdk() {
  const sdk = await import("@stellar/stellar-sdk");
  return sdk;
}

export function useMarket(): UseMarketReturn {
  const { address, signTx, isConnected } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open a trading position
  const openPosition = useCallback(
    async (
      collateral: number,
      size: number,
      isLong: boolean
    ): Promise<string | null> => {
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
        const contract = new Contract(CONTRACTS.MARKET);

        // Convert to contract amounts (7 decimals)
        const collateralAmount = toContractAmount(collateral);
        const sizeAmount = toContractAmount(size);

        // Load account
        const account = await server.getAccount(address);

        // Build the open_position operation
        const operation = contract.call(
          "open_position",
          new Address(address).toScVal(),
          nativeToScVal({ Stellar: null }, { type: { Stellar: null } }),
          nativeToScVal(collateralAmount, { type: "i128" }),
          nativeToScVal(sizeAmount, { type: "i128" }),
          nativeToScVal(isLong, { type: "bool" })
        );

        // Build transaction
        const transaction = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: NETWORK.passphrase,
        })
          .addOperation(operation)
          .setTimeout(30)
          .build();

        // Simulate to get proper footprint
        const simulated = await server.simulateTransaction(transaction);

        if (SorobanRpc.Api.isSimulationError(simulated)) {
          throw new Error(`Simulation failed: ${simulated.error}`);
        }

        // Prepare transaction with simulation results
        const prepared = SorobanRpc.assembleTransaction(
          transaction,
          simulated
        ).build();

        // Sign with Freighter
        const signedXdr = await signTx(
          prepared.toXDR(),
          NETWORK.passphrase
        );

        // Submit transaction
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
          err instanceof Error ? err.message : "Failed to open position";
        setError(errorMessage);
        console.error("Open position error:", err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [address, isConnected, signTx]
  );

  // Close a trading position
  const closePosition = useCallback(
    async (asset: "Stellar" | "USDC"): Promise<string | null> => {
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
        const contract = new Contract(CONTRACTS.MARKET);

        // Build the close_position operation
        const assetScVal =
          asset === "Stellar"
            ? nativeToScVal({ Stellar: null }, { type: { Stellar: null } })
            : nativeToScVal({ USDC: null }, { type: { USDC: null } });

        const operation = contract.call(
          "close_position",
          new Address(address).toScVal(),
          assetScVal
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
          err instanceof Error ? err.message : "Failed to close position";
        setError(errorMessage);
        console.error("Close position error:", err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [address, isConnected, signTx]
  );

  // Get user's position (view function)
  const getPosition = useCallback(
    async (asset: "Stellar" | "USDC"): Promise<Position | null> => {
      if (!address) {
        return null;
      }

      try {
        // For now return null - implement when contracts are deployed
        return null;
      } catch (err) {
        console.error("Get position error:", err);
        return null;
      }
    },
    [address]
  );

  return {
    isLoading,
    error,
    openPosition,
    closePosition,
    getPosition,
  };
}
