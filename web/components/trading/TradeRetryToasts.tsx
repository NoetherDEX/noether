'use client';

import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { setDefaultTradeProgress } from '@/lib/stellar/txFlow';
import { retryProgressMessage } from '@/lib/utils/txCopy';

/**
 * App-wide fallback for trade retries. Any op that rebuilds and asks the
 * wallet to sign a second time (txFlow's one automatic retry) shows the same
 * explanatory toast the open/close flows wire explicitly — orders, SL/TP,
 * cancels, collateral moves, cross-margin ops and leader trades included.
 * A silent second wallet prompt reads as a bug or an attack and gets rejected.
 */
export function TradeRetryToasts() {
  useEffect(() => {
    setDefaultTradeProgress((op, progress) => {
      if (progress === 'retrying') toast(retryProgressMessage(op), { id: `retry-${op}`, icon: '⟳' });
    });
    return () => setDefaultTradeProgress(null);
  }, []);
  return null;
}
