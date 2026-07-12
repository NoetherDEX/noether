'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui';
import { OrderPanel } from './OrderPanel';
import { LeaderModeSelector } from './LeaderModeSelector';
import { useTradeStore } from '@/lib/store';
import type { DisplayPosition } from '@/types';

interface MobileTradeBarProps {
  asset: string;
  markPrice: number;
  positions: DisplayPosition[];
  onPositionOpened: () => void;
  /**
   * Increment to open the trade sheet from outside (e.g. the positions
   * empty-state "Start Trading" CTA — A13). 0/undefined never opens.
   */
  openRequest?: number;
}

/**
 * Mobile-only trade access (W-7/P4-16). Below `lg` the OrderPanel otherwise
 * stacks last on the page, forcing a deep scroll to place a trade. This
 * fixed bottom bar gives one-tap Long/Short that presets the direction in
 * the shared trade store and opens the full OrderPanel in a bottom-sheet.
 * Hidden on `lg`+ where the OrderPanel is already in the sticky sidebar.
 */
export function MobileTradeBar({ asset, markPrice, positions, onPositionOpened, openRequest = 0 }: MobileTradeBarProps) {
  const [open, setOpen] = useState(false);
  const { setDirection } = useTradeStore();

  // External open trigger (counter — every increment opens the sheet once).
  useEffect(() => {
    if (openRequest > 0) setOpen(true);
  }, [openRequest]);

  const openWith = (direction: 'Long' | 'Short') => {
    setDirection(direction);
    setOpen(true);
  };

  return (
    <>
      {/* Fixed bottom bar — mobile/tablet only */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex gap-3 max-w-md mx-auto">
          <button
            onClick={() => openWith('Long')}
            className="flex-1 rounded-md bg-long py-3 min-h-[44px] text-sm font-semibold text-background transition-colors hover:bg-long/90 active:bg-long/80"
          >
            Long
          </button>
          <button
            onClick={() => openWith('Short')}
            className="flex-1 rounded-md bg-short py-3 min-h-[44px] text-sm font-semibold text-background transition-colors hover:bg-short/90 active:bg-short/80"
          >
            Short
          </button>
        </div>
      </div>

      {/* Spacer so page content isn't hidden behind the fixed bar */}
      <div className="lg:hidden h-20" aria-hidden />

      <Modal isOpen={open} onClose={() => setOpen(false)} title={`Trade ${asset}-PERP`} size="md">
        <div className="space-y-4">
          <LeaderModeSelector />
          <OrderPanel
            asset={asset}
            markPrice={markPrice}
            positions={positions}
            onPositionOpened={() => {
              onPositionOpened();
              setOpen(false);
            }}
          />
        </div>
      </Modal>
    </>
  );
}
