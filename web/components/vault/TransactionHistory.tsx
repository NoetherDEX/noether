'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Skeleton } from '@/components/ui';
import { formatNumber, formatDateTime } from '@/lib/utils';
import { NETWORK } from '@/lib/utils/constants';

interface VaultTransaction {
  id: string;
  type: 'deposit' | 'withdraw';
  usdcAmount: number;
  noeAmount: number;
  timestamp: string;
  txHash: string;
}

interface TransactionHistoryProps {
  publicKey: string | null;
  isConnected: boolean;
}

export function TransactionHistorySkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transaction History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between p-4 bg-white/5 rounded-xl"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-lg" />
                <div>
                  <Skeleton className="h-4 w-20 mb-1" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function TransactionHistory({ publicKey, isConnected }: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<VaultTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(5);

  const fetchTransactions = useCallback(async () => {
    if (!publicKey) return;

    setIsLoading(true);
    try {
      // Fetch operations from Horizon API
      const response = await fetch(
        `${NETWORK.HORIZON_URL}/accounts/${publicKey}/operations?limit=100&order=desc`
      );

      if (!response.ok) {
        if (response.status === 404) {
          // Account not found or no operations
          setTransactions([]);
          return;
        }
        throw new Error(`Horizon API error: ${response.status}`);
      }

      const data = await response.json();
      const operations = data._embedded?.records || [];

      // Filter for vault-related operations (invoke_host_function calls to vault contract)
      const vaultTxs: VaultTransaction[] = [];

      for (const op of operations) {
        // Look for Soroban invoke_host_function operations
        if (op.type === 'invoke_host_function') {
          // Check if this operation involves the vault contract
          // We need to check the function and parameters
          const isVaultOp = op.function === 'HostFunctionTypeHostFunctionTypeInvokeContract';

          // For now, we'll include operations that mention our vault or NOE token
          // In production, you'd parse the parameters more carefully
          if (op.source_account === publicKey) {
            // Try to determine if this is a deposit or withdraw based on asset transfers
            // This is a simplified heuristic
            const txHash = op.transaction_hash;

            // Fetch the transaction to get more details
            try {
              const txResponse = await fetch(`${NETWORK.HORIZON_URL}/transactions/${txHash}/operations`);
              if (txResponse.ok) {
                const txData = await txResponse.json();
                const txOps = txData._embedded?.records || [];

                // Look for token transfer patterns
                let usdcAmount = 0;
                let noeAmount = 0;
                let isDeposit = false;
                let isWithdraw = false;

                for (const txOp of txOps) {
                  // Check for SAC token transfers (invoke_host_function with transfer)
                  if (txOp.asset_code === 'USDC' || txOp.asset?.includes('USDC')) {
                    usdcAmount = parseFloat(txOp.amount || '0');
                  }
                  if (txOp.asset_code === 'NOE' || txOp.asset?.includes('NOE')) {
                    noeAmount = parseFloat(txOp.amount || '0');
                  }

                  // Heuristic: if NOE is going TO user, it's a deposit
                  // if NOE is going FROM user, it's a withdraw
                  if (txOp.to === publicKey && txOp.asset_code === 'NOE') {
                    isDeposit = true;
                  }
                  if (txOp.from === publicKey && txOp.asset_code === 'NOE') {
                    isWithdraw = true;
                  }
                }

                if ((isDeposit || isWithdraw) && (usdcAmount > 0 || noeAmount > 0)) {
                  vaultTxs.push({
                    id: op.id,
                    type: isDeposit ? 'deposit' : 'withdraw',
                    usdcAmount,
                    noeAmount,
                    timestamp: op.created_at,
                    txHash,
                  });
                }
              }
            } catch (err) {
              // Skip this transaction if we can't fetch details
              console.error('Failed to fetch tx details:', err);
            }
          }
        }

        // Also check for classic payment operations involving NOE
        if (op.type === 'payment' && op.asset_code === 'NOE') {
          const isDeposit = op.to === publicKey;
          const isWithdraw = op.from === publicKey;

          if (isDeposit || isWithdraw) {
            vaultTxs.push({
              id: op.id,
              type: isDeposit ? 'deposit' : 'withdraw',
              usdcAmount: 0, // Would need to correlate with USDC transfer
              noeAmount: parseFloat(op.amount || '0'),
              timestamp: op.created_at,
              txHash: op.transaction_hash,
            });
          }
        }
      }

      setTransactions(vaultTxs);
    } catch (error) {
      console.error('Failed to fetch transactions:', error);
      setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (!isConnected || !publicKey) {
      setTransactions([]);
      setIsLoading(false);
      return;
    }

    fetchTransactions();
  }, [publicKey, isConnected, fetchTransactions]);

  const getExplorerUrl = (txHash: string) => {
    const network = NETWORK.NAME === 'testnet' ? 'testnet' : 'public';
    return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
  };

  if (isLoading) {
    return <TransactionHistorySkeleton />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transaction History</CardTitle>
      </CardHeader>
      <CardContent>
        {!isConnected ? (
          <div className="text-center py-8 text-neutral-500">
            Connect your wallet to view transaction history
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-neutral-400 mb-1">No transactions yet</p>
            <p className="text-sm text-neutral-500">
              Your deposit and withdrawal history will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {transactions.slice(0, visibleCount).map((tx) => (
              <a
                key={tx.id}
                href={getExplorerUrl(tx.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      tx.type === 'deposit'
                        ? 'bg-emerald-500/20'
                        : 'bg-amber-500/20'
                    }`}
                  >
                    {tx.type === 'deposit' ? (
                      <ArrowDownLeft className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <ArrowUpRight className="w-5 h-5 text-amber-400" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white capitalize">
                      {tx.type}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {tx.type === 'deposit'
                        ? `+${formatNumber(tx.usdcAmount)} USDC → ${formatNumber(tx.noeAmount, 2)} NOE`
                        : `${formatNumber(tx.noeAmount, 2)} NOE → ${formatNumber(tx.usdcAmount)} USDC`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">
                    {formatDateTime(new Date(tx.timestamp))}
                  </span>
                  <ExternalLink className="w-4 h-4 text-neutral-500 group-hover:text-white transition-colors" />
                </div>
              </a>
            ))}

            {transactions.length > visibleCount && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setVisibleCount((prev) => prev + 5)}
              >
                Load More
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
