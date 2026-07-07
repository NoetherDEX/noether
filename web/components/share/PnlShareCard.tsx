'use client';

import { forwardRef } from 'react';
import { formatUSD, formatPrice, formatPercent, formatDateTime } from '@/lib/utils';
import type { PnlShareData } from '@/types';

export const PnlShareCard = forwardRef<HTMLDivElement, { data: PnlShareData }>(
  function PnlShareCard({ data }, ref) {
    const isPositive = data.pnl >= 0;
    const accentColor = isPositive ? '#22c55e' : '#ef4444';
    const sign = isPositive ? '+' : '';

    return (
      <div
        ref={ref}
        style={{ width: 480, fontFamily: 'Inter, sans-serif' }}
        className="relative overflow-hidden rounded-2xl"
      >
        {/* Gradient border wrapper */}
        <div
          className="p-[1px] rounded-2xl"
          style={{
            background: `linear-gradient(135deg, ${accentColor}40, ${accentColor}10, transparent)`,
          }}
        >
          <div className="bg-[#0a0a0c] rounded-2xl p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              {/* eslint-disable-next-line @next/next/no-img-element -- captured to PNG by html-to-image; a raw <img> with crossOrigin is required, next/image breaks canvas capture */}
              <img
                src="/noethersvg.svg"
                alt="Noether"
                width={120}
                height={28}
                crossOrigin="anonymous"
              />
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: `${accentColor}15`,
                  color: accentColor,
                }}
              >
                {data.isOpen ? 'Unrealized PnL' : 'Realized PnL'}
              </span>
            </div>

            {/* Hero PnL */}
            <div className="mb-5">
              <div
                className="text-3xl font-bold font-mono"
                style={{ color: accentColor }}
              >
                {sign}{formatUSD(data.pnl)}
              </div>
              <div
                className="text-sm font-mono mt-0.5"
                style={{ color: `${accentColor}bb` }}
              >
                {formatPercent(data.pnlPercent)}
              </div>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <div className="text-[10px] text-neutral-500 mb-0.5">Asset</div>
                <div className="text-sm text-white font-medium">{data.asset}-PERP</div>
              </div>
              <div>
                <div className="text-[10px] text-neutral-500 mb-0.5">Direction</div>
                <div className="text-sm font-medium flex items-center gap-1.5">
                  <span style={{ color: data.direction === 'Long' ? '#22c55e' : '#ef4444' }}>
                    {data.direction}
                  </span>
                  {data.leverage && (
                    <span className="text-neutral-400 text-xs">{Math.round(data.leverage)}x</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-neutral-500 mb-0.5">Entry Price</div>
                <div className="text-sm text-white font-mono">{formatPrice(data.entryPrice)}</div>
              </div>
              <div>
                <div className="text-[10px] text-neutral-500 mb-0.5">
                  {data.isOpen ? 'Mark Price' : 'Exit Price'}
                </div>
                <div className="text-sm text-white font-mono">{formatPrice(data.exitPrice)}</div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-white/5">
              <span className="text-[10px] text-neutral-600">
                {formatDateTime(data.date)}
              </span>
              <span className="text-[10px] text-neutral-600">
                noether.trade
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
