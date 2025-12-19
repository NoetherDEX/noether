"use client";

import { useState, useCallback, useEffect } from "react";
import { useWallet } from "./useWallet";
import { CONTRACTS, NETWORK, toContractAmount, fromContractAmount } from "@/lib/contracts";

// Position type matching our contract
export interface Position {
  owner: string;
  collateral: number;
  size: number;
  entryPrice: number;
  liquidationPrice: number;
  isLong: boolean;
  asset: "Stellar" | "USDC";
}

export interface OpenInterest {
  longOI: number;
  shortOI: number;
}

export interface UseMarketReturn {
  isLoading: boolean;
  error: string | null;
  positions: Position[];
  stellarPosition: Position | null;
  usdcPosition: Position | null;
  openInterest: { stellar: OpenInterest; usdc: OpenInterest };
  currentPrices: { stellar: number; usdc: number };
  openPosition: (
    collateral: number,
    size: number,
    isLong: boolean,
    asset?: "Stellar" | "USDC"
  ) => Promise<string | null>;
  closePosition: (asset: "Stellar" | "USDC") => Promise<string | null>;
  refreshPositions: () => Promise<void>;
  refreshPrices: () => Promise<void>;
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
  const [stellarPosition, setStellarPosition] = useState<Position | null>(null);
  const [usdcPosition, setUsdcPosition] = useState<Position | null>(null);
  const [openInterest, setOpenInterest] = useState<{ stellar: OpenInterest; usdc: OpenInterest }>({
    stellar: { longOI: 0, shortOI: 0 },
    usdc: { longOI: 0, shortOI: 0 },
  });
  const [currentPrices, setCurrentPrices] = useState({ stellar: 0, usdc: 1 });

  // Get all positions as array
  const positions = [stellarPosition, usdcPosition].filter((p): p is Position => p !== null);

  // Fetch a user's position from the contract
  const fetchPosition = useCallback(
    async (asset: "Stellar" | "USDC"): Promise<Position | null> => {
      if (!address || !isConnected) return null;

      try {
        const { Contract, SorobanRpc, TransactionBuilder, Keypair, BASE_FEE, Address, nativeToScVal, scValToNative } =
          await getStellarSdk();

        const server = new SorobanRpc.Server(NETWORK.rpcUrl);
        const contract = new Contract(CONTRACTS.MARKET);

        // Build the get_position call
        const assetScVal =
          asset === "Stellar"
            ? nativeToScVal({ Stellar: null }, { type: { Stellar: null } })
            : nativeToScVal({ USDC: null }, { type: { USDC: null } });

        // We need an account to simulate - use the user's account
        const account = await server.getAccount(address);

        const operation = contract.call("get_position", new Address(address).toScVal(), assetScVal);

        const transaction = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: NETWORK.passphrase,
        })
          .addOperation(operation)
          .setTimeout(30)
          .build();

        const simulated = await server.simulateTransaction(transaction);

        if (SorobanRpc.Api.isSimulationSuccess(simulated) && simulated.result) {
          const positionData = scValToNative(simulated.result.retval);

          // Also fetch position direction
          const directionOp = contract.call("get_position_direction", new Address(address).toScVal(), assetScVal);
          const dirTx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: NETWORK.passphrase,
          })
            .addOperation(directionOp)
            .setTimeout(30)
            .build();

          const dirSimulated = await server.simulateTransaction(dirTx);
          let isLong = true;
          if (SorobanRpc.Api.isSimulationSuccess(dirSimulated) && dirSimulated.result) {
            isLong = scValToNative(dirSimulated.result.retval);
          }

          return {
            owner: positionData.owner || address,
            collateral: fromContractAmount(BigInt(positionData.collateral || 0)),
            size: fromContractAmount(BigInt(positionData.size || 0)),
            entryPrice: fromContractAmount(BigInt(positionData.entry_price || 0)),
            liquidationPrice: fromContractAmount(BigInt(positionData.liquidation_price || 0)),
            isLong,
            asset,
          };
        }

        return null;
      } catch (err) {
        // Position doesn't exist or error - return null
        console.log(`No ${asset} position found:`, err);
        return null;
      }
    },
    [address, isConnected]
  );

  // Fetch open interest from the contract
  const fetchOpenInterest = useCallback(async (asset: "Stellar" | "USDC"): Promise<OpenInterest> => {
    try {
      const { Contract, SorobanRpc, TransactionBuilder, Keypair, BASE_FEE, nativeToScVal, scValToNative } =
        await getStellarSdk();

      const server = new SorobanRpc.Server(NETWORK.rpcUrl);
      const contract = new Contract(CONTRACTS.MARKET);

      // Create a temp keypair for simulation
      const tempKeypair = Keypair.random();

      // Build the get_open_interest call
      const assetScVal =
        asset === "Stellar"
          ? nativeToScVal({ Stellar: null }, { type: { Stellar: null } })
          : nativeToScVal({ USDC: null }, { type: { USDC: null } });

      // For read-only calls, we need an account - try to get one or create temp
      let account;
      try {
        account = await server.getAccount(tempKeypair.publicKey());
      } catch {
        // Account doesn't exist, simulation might still work
        return { longOI: 0, shortOI: 0 };
      }

      const operation = contract.call("get_open_interest", assetScVal);

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK.passphrase,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const simulated = await server.simulateTransaction(transaction);

      if (SorobanRpc.Api.isSimulationSuccess(simulated) && simulated.result) {
        const [longOI, shortOI] = scValToNative(simulated.result.retval);
        return {
          longOI: fromContractAmount(BigInt(longOI || 0)),
          shortOI: fromContractAmount(BigInt(shortOI || 0)),
        };
      }

      return { longOI: 0, shortOI: 0 };
    } catch (err) {
      console.error("Fetch open interest error:", err);
      return { longOI: 0, shortOI: 0 };
    }
  }, []);

  // Fetch current price from oracle
  const fetchCurrentPrice = useCallback(async (asset: "Stellar" | "USDC"): Promise<number> => {
    try {
      const { Contract, SorobanRpc, TransactionBuilder, Keypair, BASE_FEE, nativeToScVal, scValToNative } =
        await getStellarSdk();

      const server = new SorobanRpc.Server(NETWORK.rpcUrl);
      const contract = new Contract(CONTRACTS.MARKET);

      const tempKeypair = Keypair.random();

      const assetScVal =
        asset === "Stellar"
          ? nativeToScVal({ Stellar: null }, { type: { Stellar: null } })
          : nativeToScVal({ USDC: null }, { type: { USDC: null } });

      let account;
      try {
        account = await server.getAccount(tempKeypair.publicKey());
      } catch {
        return asset === "USDC" ? 1 : 0;
      }

      const operation = contract.call("get_current_price", assetScVal);

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK.passphrase,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const simulated = await server.simulateTransaction(transaction);

      if (SorobanRpc.Api.isSimulationSuccess(simulated) && simulated.result) {
        const price = scValToNative(simulated.result.retval);
        return fromContractAmount(BigInt(price || 0));
      }

      return asset === "USDC" ? 1 : 0;
    } catch (err) {
      console.error("Fetch price error:", err);
      return asset === "USDC" ? 1 : 0;
    }
  }, []);

  // Refresh all positions
  const refreshPositions = useCallback(async () => {
    if (!address || !isConnected) return;

    setIsLoading(true);
    try {
      const [stellar, usdc] = await Promise.all([fetchPosition("Stellar"), fetchPosition("USDC")]);
      setStellarPosition(stellar);
      setUsdcPosition(usdc);
    } catch (err) {
      console.error("Refresh positions error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected, fetchPosition]);

  // Refresh prices and open interest
  const refreshPrices = useCallback(async () => {
    try {
      const [stellarPrice, usdcPrice, stellarOI, usdcOI] = await Promise.all([
        fetchCurrentPrice("Stellar"),
        fetchCurrentPrice("USDC"),
        fetchOpenInterest("Stellar"),
        fetchOpenInterest("USDC"),
      ]);

      setCurrentPrices({ stellar: stellarPrice, usdc: usdcPrice });
      setOpenInterest({ stellar: stellarOI, usdc: usdcOI });
    } catch (err) {
      console.error("Refresh prices error:", err);
    }
  }, [fetchCurrentPrice, fetchOpenInterest]);

  // Auto-fetch positions when wallet connects
  useEffect(() => {
    if (isConnected && address) {
      refreshPositions();
      refreshPrices();
    }
  }, [isConnected, address, refreshPositions, refreshPrices]);

  // Open a trading position
  const openPosition = useCallback(
    async (
      collateral: number,
      size: number,
      isLong: boolean,
      asset: "Stellar" | "USDC" = "Stellar"
    ): Promise<string | null> => {
      if (!address || !isConnected) {
        setError("Wallet not connected");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const { Contract, SorobanRpc, TransactionBuilder, BASE_FEE, Address, nativeToScVal } = await getStellarSdk();

        const server = new SorobanRpc.Server(NETWORK.rpcUrl);
        const contract = new Contract(CONTRACTS.MARKET);

        // Convert to contract amounts (7 decimals)
        const collateralAmount = toContractAmount(collateral);
        const sizeAmount = toContractAmount(size);

        // Build asset enum
        const assetScVal =
          asset === "Stellar"
            ? nativeToScVal({ Stellar: null }, { type: { Stellar: null } })
            : nativeToScVal({ USDC: null }, { type: { USDC: null } });

        // Load account
        const account = await server.getAccount(address);

        // Build the open_position operation
        const operation = contract.call(
          "open_position",
          new Address(address).toScVal(),
          assetScVal,
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
        const prepared = SorobanRpc.assembleTransaction(transaction, simulated).build();

        // Sign with Freighter
        const signedXdr = await signTx(prepared.toXDR(), NETWORK.passphrase);

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
          // Refresh positions after successful trade
          await refreshPositions();
          return result.hash;
        } else {
          throw new Error("Transaction failed");
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to open position";
        setError(errorMessage);
        console.error("Open position error:", err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [address, isConnected, signTx, refreshPositions]
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
        const { Contract, SorobanRpc, TransactionBuilder, BASE_FEE, Address, nativeToScVal } = await getStellarSdk();

        const server = new SorobanRpc.Server(NETWORK.rpcUrl);
        const contract = new Contract(CONTRACTS.MARKET);

        // Build the close_position operation
        const assetScVal =
          asset === "Stellar"
            ? nativeToScVal({ Stellar: null }, { type: { Stellar: null } })
            : nativeToScVal({ USDC: null }, { type: { USDC: null } });

        const operation = contract.call("close_position", new Address(address).toScVal(), assetScVal);

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
        const prepared = SorobanRpc.assembleTransaction(transaction, simulated).build();
        const signedXdr = await signTx(prepared.toXDR(), NETWORK.passphrase);

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
          // Refresh positions after successful close
          await refreshPositions();
          return result.hash;
        } else {
          throw new Error("Transaction failed");
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to close position";
        setError(errorMessage);
        console.error("Close position error:", err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [address, isConnected, signTx, refreshPositions]
  );

  return {
    isLoading,
    error,
    positions,
    stellarPosition,
    usdcPosition,
    openInterest,
    currentPrices,
    openPosition,
    closePosition,
    refreshPositions,
    refreshPrices,
  };
}
