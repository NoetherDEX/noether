'use client';

import { forwardRef } from 'react';
import { formatUSD, formatPrice, formatPercent, formatDateTime } from '@/lib/utils';
import type { PnlShareData } from '@/types';

export const PnlShareCard = forwardRef<HTMLDivElement, { data: PnlShareData }>(
  function PnlShareCard({ data }, ref) {
    const isPositive = data.pnl >= 0;
    // Token PnL colors (hex literals: this card is captured to PNG by
    // html-to-image, so colors stay inline rather than CSS-var-dependent).
    const accentColor = isPositive ? '#16C784' : '#EA3943';
    const sign = isPositive ? '+' : '';

    return (
      <div
        ref={ref}
        style={{ width: 480, fontFamily: 'Inter, sans-serif' }}
        className="relative overflow-hidden rounded-lg"
      >
        {/* Hairline border wrapper */}
        <div
          className="p-[1px] rounded-lg"
          style={{ background: 'rgba(255,255,255,0.12)' }}
        >
          <div className="bg-[#0B0D10] rounded-lg p-6">
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
                className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-sm"
                style={{
                  backgroundColor: `${accentColor}1f`,
                  color: accentColor,
                }}
              >
                {data.isOpen ? 'Unrealized PnL' : 'Realized PnL'}
              </span>
            </div>

            {/* Hero PnL */}
            <div className="mb-5">
              <div
                className="text-3xl font-semibold font-mono tabular-nums"
                style={{ color: accentColor }}
              >
                {sign}{formatUSD(data.pnl)}
              </div>
              <div
                className="text-sm font-mono tabular-nums mt-0.5"
                style={{ color: `${accentColor}bb` }}
              >
                {formatPercent(data.pnlPercent)}
              </div>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#646B73] mb-0.5">Asset</div>
                <div className="text-sm text-[#E8EAED] font-medium">{data.asset}-PERP</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#646B73] mb-0.5">Direction</div>
                <div className="text-sm font-medium flex items-center gap-1.5">
                  <span style={{ color: data.direction === 'Long' ? '#16C784' : '#EA3943' }}>
                    {data.direction}
                  </span>
                  {data.leverage && (
                    <span className="text-[#9BA1A8] text-xs font-mono tabular-nums">{Math.round(data.leverage)}x</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#646B73] mb-0.5">Entry Price</div>
                <div className="text-sm text-[#E8EAED] font-mono tabular-nums">{formatPrice(data.entryPrice)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#646B73] mb-0.5">
                  {data.isOpen ? 'Mark Price' : 'Exit Price'}
                </div>
                <div className="text-sm text-[#E8EAED] font-mono tabular-nums">{formatPrice(data.exitPrice)}</div>
              </div>
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between pt-3"
              style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
            >
              <span className="text-[10px] font-mono tabular-nums text-[#646B73]">
                {formatDateTime(data.date)}
              </span>
              <span className="text-[10px] text-[#646B73]">
                noether.trade
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
