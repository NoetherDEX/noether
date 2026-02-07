'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Skeleton } from '@/components/ui';
import { formatNumber, formatDateTime } from '@/lib/utils';
import { NETWORK, NOE_ASSET } from '@/lib/utils/constants';

interface NoeTransaction {
  id: string;
  type: 'received' | 'sent';
  amount: number;
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
                <Skeleton className="w-4 h-4 rounded" />
                <div>
                  <Skeleton className="h-4 w-20 mb-1" />
                  <Skeleton className="h-3 w-24" />
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
  const [transactions, setTransactions] = useState<NoeTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(5);

  const fetchTransactions = useCallback(async () => {
    if (!publicKey) return;

    setIsLoading(true);
    try {
      // Use Horizon's effects endpoint - reliably tracks all balance changes
      // including SAC (Soroban Asset Contract) token transfers
      const url = `${NETWORK.HORIZON_URL}/accounts/${publicKey}/effects?limit=100&order=desc`;

      console.log('[TransactionHistory] Fetching effects from Horizon:', url);

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          console.log('[TransactionHistory] Account not found or no effects');
          setTransactions([]);
          return;
        }
        throw new Error(`Horizon API error: ${response.status}`);
      }

      const data = await response.json();
      const effects = data._embedded?.records || [];

      console.log('[TransactionHistory] Raw effects count:', effects.length);

      // Filter for NOE token balance changes (credited/debited)
      const noeTxs: NoeTransaction[] = [];
      const seenTxHashes = new Set<string>();

      for (const effect of effects) {
        // Check if this effect involves NOE token
        const isNoeEffect =
          effect.asset_code === NOE_ASSET.CODE &&
          effect.asset_issuer === NOE_ASSET.ISSUER;

        if (!isNoeEffect) continue;

        // Get transaction hash from the effect's links
        const txHash = effect.transaction_hash ||
          (effect._links?.operation?.href?.split('/operations/')[0]?.split('/transactions/')[1]) ||
          '';

        // Deduplicate by transaction hash (same tx can have multiple effects)
        if (txHash && seenTxHashes.has(txHash)) continue;
        if (txHash) seenTxHashes.add(txHash);

        // Determine type based on effect type
        let type: 'received' | 'sent' | null = null;
        let amount = 0;

        if (effect.type === 'account_credited') {
          type = 'received';
          amount = parseFloat(effect.amount || '0');
        } else if (effect.type === 'account_debited') {
          type = 'sent';
          amount = parseFloat(effect.amount || '0');
        }

        if (type && amount > 0) {
          noeTxs.push({
            id: effect.id || effect.paging_token,
            type,
            amount,
            timestamp: effect.created_at,
            txHash,
          });
        }
      }

      console.log('[TransactionHistory] Filtered NOE transactions:', noeTxs.length);

      setTransactions(noeTxs);
    } catch (error) {
      console.error('[TransactionHistory] Failed to fetch transactions:', error);
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
    if (!txHash) return '#';
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
            <p className="text-neutral-400 mb-1">No NOE transactions yet</p>
            <p className="text-sm text-neutral-500">
              Your NOE transfer history will appear here.
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
                  {tx.type === 'received' ? (
                    <ArrowDownLeft className="w-4 h-4 text-[#22c55e]" />
                  ) : (
                    <ArrowUpRight className="w-4 h-4 text-[#f59e0b]" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-white">
                      {tx.type === 'received' ? 'Received' : 'Sent'} NOE
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatDateTime(new Date(tx.timestamp))}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-mono font-medium ${
                      tx.type === 'received' ? 'text-[#22c55e]' : 'text-[#f59e0b]'
                    }`}
                  >
                    {tx.type === 'received' ? '+' : '-'}
                    {formatNumber(tx.amount, 4)} NOE
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-white/20 group-hover:text-white/40 transition-colors" />
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
