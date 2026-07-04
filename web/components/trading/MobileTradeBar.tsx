'use client';

import { useState } from 'react';
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
}

/**
 * Mobile-only trade access (W-7/P4-16). Below `lg` the OrderPanel otherwise
 * stacks last on the page, forcing a deep scroll to place a trade. This
 * fixed bottom bar gives one-tap Long/Short that presets the direction in
 * the shared trade store and opens the full OrderPanel in a bottom-sheet.
 * Hidden on `lg`+ where the OrderPanel is already in the sticky sidebar.
 */
export function MobileTradeBar({ asset, markPrice, positions, onPositionOpened }: MobileTradeBarProps) {
  const [open, setOpen] = useState(false);
  const { setDirection } = useTradeStore();

  const openWith = (direction: 'Long' | 'Short') => {
    setDirection(direction);
    setOpen(true);
  };

  return (
    <>
      {/* Fixed bottom bar — mobile/tablet only */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-white/10 bg-[#0a0a0a]/95 backdrop-blur px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex gap-3 max-w-md mx-auto">
          <button
            onClick={() => openWith('Long')}
            className="flex-1 rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-black active:bg-emerald-600"
          >
            Long
          </button>
          <button
            onClick={() => openWith('Short')}
            className="flex-1 rounded-xl bg-red-500 py-3 text-sm font-semibold text-black active:bg-red-600"
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
