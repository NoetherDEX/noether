'use client';

import { memo, useState } from 'react';
import { TrendingUp, X, RefreshCw, Share2, AlertTriangle, Shield, Target } from 'lucide-react';
import { Button, Badge, Modal, Card } from '@/components/ui';
import { formatUSD, formatPrice, formatPercent, formatDateTime, priceDecimals } from '@/lib/utils';
import { formatPairPrice } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import type { DisplayPosition, DisplayOrder, PnlShareData } from '@/types';
import { PnlShareModal } from '@/components/share/PnlShareModal';

// Field-value equality for DisplayPosition. The parent's useMemo always
// produces fresh object references when prices tick, so default shallow
// memo would re-render every row even when nothing visible changed.
// Callback identity is intentionally ignored — handlers close over the
// position via setSelectedPosition, so a new closure each render is
// fine until the user actually clicks.
function positionEquals(a: DisplayPosition, b: DisplayPosition): boolean {
  return a.id === b.id
    && a.currentPrice === b.currentPrice
    && a.pnl === b.pnl
    && a.pnlPercent === b.pnlPercent
    && a.collateral === b.collateral
    && a.size === b.size
    && a.entryPrice === b.entryPrice
    && a.liquidationPrice === b.liquidationPrice
    && a.leverage === b.leverage
    && a.direction === b.direction
    && a.marginMode === b.marginMode;
}

interface PositionsListProps {
  positions: DisplayPosition[];
  /** B8: the trader's orders (already fetched by the page) — used to show a
   *  per-row TP/SL cell so protected vs unprotected is visible at a glance. */
  orders?: DisplayOrder[];
  isLoading?: boolean;
  isRefreshing?: boolean;
  onClosePosition?: (id: number) => Promise<void>;
  onSetStopLoss?: (id: number, triggerPrice: number, slippageBps: number) => Promise<void>;
  onSetTakeProfit?: (id: number, triggerPrice: number, slippageBps: number, limitPrice?: number) => Promise<void>;
  onRefresh?: () => void;
  /** Empty-state "Start Trading" action (A13) — the button only renders when wired. */
  onStartTrading?: () => void;
}

export function PositionsList({
  positions,
  orders,
  isLoading,
  isRefreshing,
  onClosePosition,
  onSetStopLoss,
  onSetTakeProfit,
  onRefresh,
  onStartTrading,
}: PositionsListProps) {
  const [selectedPosition, setSelectedPosition] = useState<DisplayPosition | null>(null);
  const [actionModal, setActionModal] = useState<'close' | 'stop-loss' | 'take-profit' | null>(null);

  // B8: pending SL/TP triggers per position, from the orders the page
  // already polls — protected vs unprotected at a glance, no extra RPC.
  const protectionByPosition = new Map<number, { tp?: number; sl?: number }>();
  for (const o of orders ?? []) {
    if (o.status !== 'Pending' || !o.positionId) continue;
    if (o.orderType !== 'StopLoss' && o.orderType !== 'TakeProfit') continue;
    const entry = protectionByPosition.get(o.positionId) ?? {};
    if (o.orderType === 'StopLoss') entry.sl = o.triggerPrice;
    else entry.tp = o.triggerPrice;
    protectionByPosition.set(o.positionId, entry);
  }
  const [slTpPrice, setSlTpPrice] = useState('');
  const [slTpSlippage, setSlTpSlippage] = useState(50); // 0.5% default
  const [customSlTpSlippage, setCustomSlTpSlippage] = useState('');
  const [tpLimitPrice, setTpLimitPrice] = useState('');
  const [customPct, setCustomPct] = useState('');
  const [selectedPct, setSelectedPct] = useState<number | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [isSettingSLTP, setIsSettingSLTP] = useState(false);
  const [shareData, setShareData] = useState<PnlShareData | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);

  const handleShare = (position: DisplayPosition) => {
    setShareData({
      asset: position.asset,
      direction: position.direction,
      leverage: position.leverage,
      entryPrice: position.entryPrice,
      exitPrice: position.currentPrice,
      pnl: position.pnl,
      pnlPercent: position.pnlPercent,
      date: position.openedAt,
      isOpen: true,
    });
    setShowShareModal(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 bg-surface-3 rounded-md animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="relative mb-4">
          <div className="w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-faint" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <span className="text-faint text-xs font-mono">0</span>
          </div>
        </div>
        <h3 className="text-foreground font-medium mb-1">No open positions</h3>
        <p className="text-muted-foreground text-sm text-center max-w-xs">
          Open a position to start trading. Your active trades will appear here.
        </p>
        {onStartTrading && (
          <button
            onClick={onStartTrading}
            className="mt-4 inline-flex h-9 items-center px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Start Trading
          </button>
        )}
      </div>
    );
  }

  const handleClose = async () => {
    if (!selectedPosition || !onClosePosition || isClosing) return;

    setIsClosing(true);
    try {
      await onClosePosition(selectedPosition.id);
      setActionModal(null);
      setSelectedPosition(null);
    } catch (error) {
      console.error('Failed to close position:', error);
    } finally {
      setIsClosing(false);
    }
  };

  const handleSetStopLoss = async () => {
    if (!selectedPosition || !onSetStopLoss || !slTpPrice || isSettingSLTP) return;

    setIsSettingSLTP(true);
    try {
      await onSetStopLoss(selectedPosition.id, parseFloat(slTpPrice), slTpSlippage);
      setActionModal(null);
      setSelectedPosition(null);
      setSlTpPrice('');
    } catch (error) {
      console.error('Failed to set stop-loss:', error);
    } finally {
      setIsSettingSLTP(false);
    }
  };

  const handleSetTakeProfit = async () => {
    if (!selectedPosition || !onSetTakeProfit || !slTpPrice || isSettingSLTP) return;

    setIsSettingSLTP(true);
    try {
      const limitPriceNum = parseFloat(tpLimitPrice) || 0;
      await onSetTakeProfit(selectedPosition.id, parseFloat(slTpPrice), slTpSlippage, limitPriceNum > 0 ? limitPriceNum : undefined);
      setActionModal(null);
      setSelectedPosition(null);
      setSlTpPrice('');
      setTpLimitPrice('');
    } catch (error) {
      console.error('Failed to set take-profit:', error);
    } finally {
      setIsSettingSLTP(false);
    }
  };

  // Check if position is at liquidation risk (within 10% of mark price)
  // Cross-margin positions don't have per-position liq price
  const isLiquidationRisk = (pos: DisplayPosition) => {
    if (pos.marginMode === 'Cross') return false;
    if (pos.currentPrice === 0) return false;
    const diff = Math.abs(pos.liquidationPrice - pos.currentPrice) / pos.currentPrice;
    return diff < 0.1;
  };

  return (
    <>
      {/* Header with Refresh Button */}
      {positions.length > 0 && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-muted-foreground">
            {positions.length} open position{positions.length !== 1 ? 's' : ''}
          </span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors',
                'text-muted-foreground hover:text-foreground hover:bg-surface-3',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              title="Refresh positions"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}
        </div>
      )}

      {/* Desktop Table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface z-10">
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Market</th>
              <th className="text-right px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Size</th>
              <th className="text-right px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Net Value</th>
              <th className="text-right px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Entry / Mark</th>
              <th className="text-right px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Liq. Price</th>
              <th className="text-right px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">TP / SL</th>
              <th className="text-right px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">PnL</th>
              <th className="text-center px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Actions</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <PositionRow
                key={position.id}
                position={position}
                isLiquidationRisk={isLiquidationRisk(position)}
                onClose={() => {
                  setSelectedPosition(position);
                  setActionModal('close');
                }}
                onSetStopLoss={() => {
                  setSelectedPosition(position);
                  // Suggest a stop-loss 5% below entry for long, 5% above for short
                  const suggestedSL = position.direction === 'Long'
                    ? position.entryPrice * 0.95
                    : position.entryPrice * 1.05;
                  setSlTpPrice(suggestedSL.toFixed(priceDecimals(position.asset)));
                  setActionModal('stop-loss');
                }}
                onSetTakeProfit={() => {
                  setSelectedPosition(position);
                  // Suggest a take-profit 10% above entry for long, 10% below for short
                  const suggestedTP = position.direction === 'Long'
                    ? position.entryPrice * 1.10
                    : position.entryPrice * 0.90;
                  setSlTpPrice(suggestedTP.toFixed(priceDecimals(position.asset)));
                  setActionModal('take-profit');
                }}
                hasSlTpCallbacks={!!onSetStopLoss && !!onSetTakeProfit}
                protection={protectionByPosition.get(position.id)}
                onShare={() => handleShare(position)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="lg:hidden space-y-3">
        {positions.map((position) => (
          <PositionCard
            key={position.id}
            position={position}
            onClose={() => {
              setSelectedPosition(position);
              setActionModal('close');
            }}
            onSetStopLoss={() => {
              setSelectedPosition(position);
              const suggestedSL = position.direction === 'Long'
                ? position.entryPrice * 0.95
                : position.entryPrice * 1.05;
              setSlTpPrice(suggestedSL.toFixed(priceDecimals(position.asset)));
              setActionModal('stop-loss');
            }}
            onSetTakeProfit={() => {
              setSelectedPosition(position);
              const suggestedTP = position.direction === 'Long'
                ? position.entryPrice * 1.10
                : position.entryPrice * 0.90;
              setSlTpPrice(suggestedTP.toFixed(priceDecimals(position.asset)));
              setActionModal('take-profit');
            }}
            hasSlTpCallbacks={!!onSetStopLoss && !!onSetTakeProfit}
            onShare={() => handleShare(position)}
          />
        ))}
      </div>

      {/* Close Position Modal */}
      <Modal
        isOpen={actionModal === 'close'}
        onClose={() => setActionModal(null)}
        title="Close Position"
        size="sm"
      >
        {selectedPosition && (
          <div>
            <div className="mb-6 pb-4 border-b border-border space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Position</span>
                <span className="text-foreground">
                  {selectedPosition.asset} {selectedPosition.direction}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Size</span>
                <span className="text-foreground">{formatUSD(selectedPosition.size)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Unrealized PnL</span>
                <span className={selectedPosition.pnl >= 0 ? 'text-long' : 'text-short'}>
                  {formatUSD(selectedPosition.pnl)} ({formatPercent(selectedPosition.pnlPercent)})
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setActionModal(null)}
                disabled={isClosing}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={handleClose}
                disabled={isClosing}
                isLoading={isClosing}
              >
                {isClosing ? 'Closing...' : 'Close Position'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Stop-Loss Modal */}
      <Modal
        isOpen={actionModal === 'stop-loss'}
        onClose={() => setActionModal(null)}
        title="Set Stop-Loss"
        size="sm"
      >
        {selectedPosition && (() => {
          const triggerPrice = parseFloat(slTpPrice) || 0;
          const entry = selectedPosition.entryPrice;
          const isLong = selectedPosition.direction === 'Long';
          const distFromEntry = entry > 0 ? ((triggerPrice - entry) / entry) * 100 : 0;
          const estPnl = entry > 0 ? selectedPosition.size * (isLong ? (triggerPrice - entry) / entry : (entry - triggerPrice) / entry) : 0;
          const estPnlPct = selectedPosition.size > 0 ? (estPnl / (selectedPosition.size / selectedPosition.leverage)) * 100 : 0;
          const invalid = triggerPrice > 0 && (isLong ? triggerPrice >= entry : triggerPrice <= entry);
          const decimals = priceDecimals(selectedPosition.asset);
          const slQuickPcts = isLong ? [-2, -5, -10] : [2, 5, 10];

          return (
            <div>
              <div className="mb-4 pb-4 border-b border-border space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Position</span>
                  <span className="text-foreground">{selectedPosition.asset} {selectedPosition.direction}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Size</span>
                  <span className="text-foreground">{formatUSD(selectedPosition.size)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Entry Price</span>
                  <span className="text-foreground">{formatUSD(entry, decimals)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Price</span>
                  <span className="text-foreground">{formatUSD(selectedPosition.currentPrice, decimals)}</span>
                </div>
              </div>

              {/* Quick-set % buttons */}
              <div className="grid grid-flow-col auto-cols-fr gap-0.5 bg-surface-2 rounded-md p-0.5 mb-3">
                {slQuickPcts.map((pct) => (
                  <button
                    key={pct}
                    onClick={() => {
                      const price = entry * (1 + pct / 100);
                      setSlTpPrice(price.toFixed(decimals));
                      setCustomPct('');
                      setSelectedPct(pct);
                    }}
                    className={cn(
                      'rounded-[4px] py-1.5 text-xs font-medium transition-colors',
                      selectedPct === pct
                        ? 'bg-surface-3 text-short'
                        : 'text-muted-foreground hover:text-short'
                    )}
                  >
                    {pct > 0 ? '+' : ''}{pct}%
                  </button>
                ))}
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={customPct}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      setCustomPct(val);
                      setSelectedPct(null);
                      const parsed = parseFloat(val);
                      if (!isNaN(parsed) && parsed > 0) {
                        const pct = isLong ? -parsed : parsed;
                        const price = entry * (1 + pct / 100);
                        setSlTpPrice(price.toFixed(decimals));
                      }
                    }}
                    placeholder="Custom"
                    className={cn(
                      'w-full h-full rounded-[4px] bg-transparent px-2 py-1.5 text-xs font-mono text-center placeholder:text-faint focus:outline-none transition-colors pr-4',
                      customPct !== '' ? 'bg-surface-3 text-short' : 'text-muted-foreground'
                    )}
                  />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-faint">%</span>
                </div>
              </div>

              <div className="mb-1">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-muted-foreground">Trigger Price (USD)</label>
                  {triggerPrice > 0 && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {Math.abs(distFromEntry).toFixed(1)}% from entry
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.0001"
                    value={slTpPrice}
                    onChange={(e) => { setSlTpPrice(e.target.value); setSelectedPct(null); setCustomPct(''); }}
                    placeholder="0.00"
                    className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-right font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-short focus:border-short transition-colors pr-12"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">USD</span>
                </div>
              </div>

              {/* PnL Preview */}
              {triggerPrice > 0 && !invalid && (
                <div className="mb-4 border-l-2 border-short/60 pl-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Est. loss at trigger</span>
                    <span className="text-short font-mono font-medium">
                      {estPnl >= 0 ? '+' : ''}{formatUSD(estPnl, 2)} ({estPnlPct >= 0 ? '+' : ''}{estPnlPct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              )}

              {!triggerPrice && (
                <p className="text-xs text-muted-foreground mb-4">
                  {isLong ? 'Position closes when price drops to this level' : 'Position closes when price rises to this level'}
                </p>
              )}

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-muted-foreground">Slippage Tolerance</label>
                  <span className="text-xs font-mono text-foreground">{(slTpSlippage / 100).toFixed(2)}%</span>
                </div>
                <div className="grid grid-flow-col auto-cols-fr gap-0.5 bg-surface-2 rounded-md p-0.5">
                  {[50, 100, 200].map((bps) => (
                    <button
                      key={bps}
                      onClick={() => { setSlTpSlippage(bps); setCustomSlTpSlippage(''); }}
                      className={cn(
                        'rounded-[4px] py-1.5 text-xs font-medium transition-colors',
                        slTpSlippage === bps && customSlTpSlippage === ''
                          ? 'bg-surface-3 text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {(bps / 100).toFixed(1)}%
                    </button>
                  ))}
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={customSlTpSlippage}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9.]/g, '');
                        setCustomSlTpSlippage(val);
                        const parsed = parseFloat(val);
                        if (!isNaN(parsed) && parsed > 0 && parsed <= 100) setSlTpSlippage(Math.round(parsed * 100));
                      }}
                      placeholder="Custom"
                      className={cn(
                        'w-full h-full rounded-[4px] bg-transparent px-2 py-1.5 text-xs font-mono text-center placeholder:text-faint focus:outline-none transition-colors pr-4',
                        customSlTpSlippage !== '' ? 'bg-surface-3 text-foreground' : 'text-muted-foreground'
                      )}
                    />
                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-faint">%</span>
                  </div>
                </div>
              </div>

              {invalid && (
                <div className="mb-4 border-l-2 border-short/60 pl-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-short mt-0.5 shrink-0" />
                  <p className="text-xs text-short">
                    {isLong ? 'Stop-loss must be below entry price for Long positions' : 'Stop-loss must be above entry price for Short positions'}
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setActionModal(null)} disabled={isSettingSLTP}>Cancel</Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={handleSetStopLoss}
                  disabled={!slTpPrice || isSettingSLTP || invalid}
                  isLoading={isSettingSLTP}
                >
                  <Shield className="w-4 h-4 mr-1" />
                  Set Stop-Loss
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Take-Profit Modal */}
      <Modal
        isOpen={actionModal === 'take-profit'}
        onClose={() => setActionModal(null)}
        title="Set Take-Profit"
        size="sm"
      >
        {selectedPosition && (() => {
          const triggerPrice = parseFloat(slTpPrice) || 0;
          const entry = selectedPosition.entryPrice;
          const isLong = selectedPosition.direction === 'Long';
          const distFromEntry = entry > 0 ? ((triggerPrice - entry) / entry) * 100 : 0;
          const estPnl = entry > 0 ? selectedPosition.size * (isLong ? (triggerPrice - entry) / entry : (entry - triggerPrice) / entry) : 0;
          const estPnlPct = selectedPosition.size > 0 ? (estPnl / (selectedPosition.size / selectedPosition.leverage)) * 100 : 0;
          const invalid = triggerPrice > 0 && (isLong ? triggerPrice <= entry : triggerPrice >= entry);
          const decimals = priceDecimals(selectedPosition.asset);
          const tpQuickPcts = isLong ? [5, 10, 15] : [-5, -10, -15];

          return (
            <div>
              <div className="mb-4 pb-4 border-b border-border space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Position</span>
                  <span className="text-foreground">{selectedPosition.asset} {selectedPosition.direction}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Size</span>
                  <span className="text-foreground">{formatUSD(selectedPosition.size)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Entry Price</span>
                  <span className="text-foreground">{formatUSD(entry, decimals)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Price</span>
                  <span className="text-foreground">{formatUSD(selectedPosition.currentPrice, decimals)}</span>
                </div>
              </div>

              {/* Quick-set % buttons */}
              <div className="grid grid-flow-col auto-cols-fr gap-0.5 bg-surface-2 rounded-md p-0.5 mb-3">
                {tpQuickPcts.map((pct) => (
                  <button
                    key={pct}
                    onClick={() => {
                      const price = entry * (1 + pct / 100);
                      setSlTpPrice(price.toFixed(decimals));
                      setCustomPct('');
                      setSelectedPct(pct);
                    }}
                    className={cn(
                      'rounded-[4px] py-1.5 text-xs font-medium transition-colors',
                      selectedPct === pct
                        ? 'bg-surface-3 text-long'
                        : 'text-muted-foreground hover:text-long'
                    )}
                  >
                    {pct > 0 ? '+' : ''}{pct}%
                  </button>
                ))}
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={customPct}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      setCustomPct(val);
                      setSelectedPct(null);
                      const parsed = parseFloat(val);
                      if (!isNaN(parsed) && parsed > 0) {
                        const pct = isLong ? parsed : -parsed;
                        const price = entry * (1 + pct / 100);
                        setSlTpPrice(price.toFixed(decimals));
                      }
                    }}
                    placeholder="Custom"
                    className={cn(
                      'w-full h-full rounded-[4px] bg-transparent px-2 py-1.5 text-xs font-mono text-center placeholder:text-faint focus:outline-none transition-colors pr-4',
                      customPct !== '' ? 'bg-surface-3 text-long' : 'text-muted-foreground'
                    )}
                  />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-faint">%</span>
                </div>
              </div>

              <div className="mb-1">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-muted-foreground">Trigger Price (USD)</label>
                  {triggerPrice > 0 && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {Math.abs(distFromEntry).toFixed(1)}% from entry
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.0001"
                    value={slTpPrice}
                    onChange={(e) => { setSlTpPrice(e.target.value); setSelectedPct(null); setCustomPct(''); }}
                    placeholder="0.00"
                    className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-right font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-long focus:border-long transition-colors pr-12"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">USD</span>
                </div>
              </div>

              {/* PnL Preview */}
              {triggerPrice > 0 && !invalid && (
                <div className="mb-4 border-l-2 border-long/60 pl-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Est. profit at trigger</span>
                    <span className="text-long font-mono font-medium">
                      +{formatUSD(estPnl, 2)} (+{estPnlPct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              )}

              {!triggerPrice && (
                <p className="text-xs text-muted-foreground mb-4">
                  {isLong ? 'Position closes when price rises to this level' : 'Position closes when price drops to this level'}
                </p>
              )}

              <div className="mb-4">
                <label className="text-sm text-muted-foreground mb-2 block">
                  Limit Price (USD) <span className="text-muted-foreground/50">— optional</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.0001"
                    value={tpLimitPrice}
                    onChange={(e) => setTpLimitPrice(e.target.value)}
                    placeholder="Market execution"
                    className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-right font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-long focus:border-long transition-colors pr-12"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">USD</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Set a limit price for Take Limit execution. Leave empty for market.
                </p>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-muted-foreground">Slippage Tolerance</label>
                  <span className="text-xs font-mono text-foreground">{(slTpSlippage / 100).toFixed(2)}%</span>
                </div>
                <div className="grid grid-flow-col auto-cols-fr gap-0.5 bg-surface-2 rounded-md p-0.5">
                  {[50, 100, 200].map((bps) => (
                    <button
                      key={bps}
                      onClick={() => { setSlTpSlippage(bps); setCustomSlTpSlippage(''); }}
                      className={cn(
                        'rounded-[4px] py-1.5 text-xs font-medium transition-colors',
                        slTpSlippage === bps && customSlTpSlippage === ''
                          ? 'bg-surface-3 text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {(bps / 100).toFixed(1)}%
                    </button>
                  ))}
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={customSlTpSlippage}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9.]/g, '');
                        setCustomSlTpSlippage(val);
                        const parsed = parseFloat(val);
                        if (!isNaN(parsed) && parsed > 0 && parsed <= 100) setSlTpSlippage(Math.round(parsed * 100));
                      }}
                      placeholder="Custom"
                      className={cn(
                        'w-full h-full rounded-[4px] bg-transparent px-2 py-1.5 text-xs font-mono text-center placeholder:text-faint focus:outline-none transition-colors pr-4',
                        customSlTpSlippage !== '' ? 'bg-surface-3 text-foreground' : 'text-muted-foreground'
                      )}
                    />
                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-faint">%</span>
                  </div>
                </div>
              </div>

              {invalid && (
                <div className="mb-4 border-l-2 border-short/60 pl-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-short mt-0.5 shrink-0" />
                  <p className="text-xs text-short">
                    {isLong ? 'Take-profit must be above entry price for Long positions' : 'Take-profit must be below entry price for Short positions'}
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setActionModal(null)} disabled={isSettingSLTP}>Cancel</Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleSetTakeProfit}
                  disabled={!slTpPrice || isSettingSLTP || invalid}
                  isLoading={isSettingSLTP}
                >
                  <Target className="w-4 h-4 mr-1" />
                  Set Take-Profit
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Share PnL Modal */}
      <PnlShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        data={shareData}
      />
    </>
  );
}

// Table row component
const PositionRow = memo(function PositionRow({
  position,
  isLiquidationRisk,
  onClose,
  onSetStopLoss,
  onSetTakeProfit,
  hasSlTpCallbacks,
  protection,
  onShare,
}: {
  position: DisplayPosition;
  isLiquidationRisk: boolean;
  onClose: () => void;
  onSetStopLoss: () => void;
  onSetTakeProfit: () => void;
  hasSlTpCallbacks: boolean;
  protection?: { tp?: number; sl?: number };
  onShare: () => void;
}) {
  // NaN pnl = mark price unknown — render '—' in neutral color, never a
  // signed/colored fabrication (formatters dash NaN automatically).
  const hasPnl = Number.isFinite(position.pnl);
  const isPositive = hasPnl && position.pnl >= 0;
  // M-3 interim guard: SL/TP orders on cross positions execute via the
  // isolated close path on-chain, corrupting the shared pool. Disabled
  // until the contract fix deploys.
  const isCross = position.marginMode === 'Cross';

  return (
    <tr className="border-b border-border hover:bg-surface-3/50 transition-colors">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{position.asset}-PERP</span>
          <span
            className={cn(
              'px-1.5 py-0.5 rounded-sm text-[11px] font-medium font-mono',
              position.direction === 'Long'
                ? 'bg-long/10 text-long'
                : 'bg-short/10 text-short'
            )}
          >
            {position.leverage.toFixed(0)}x
          </span>
        </div>
        <span
          className={cn(
            'text-[10px] font-medium',
            position.direction === 'Long' ? 'text-long' : 'text-short'
          )}
        >
          {position.direction.toUpperCase()}
          {position.marginMode === 'Cross' && (
            <span className="ml-1 text-[9px] px-1 py-0.5 bg-primary/10 text-primary rounded-sm">CROSS</span>
          )}
        </span>
      </td>

      <td className="px-3 py-2 text-right">
        <div className="font-mono text-foreground">
          {formatUSD(position.size, 0)}
        </div>
        <div className="font-mono text-muted-foreground text-[10px]">
          {position.collateral.toFixed(2)} USDC
        </div>
      </td>

      <td className="px-3 py-2 text-right">
        <span className="font-mono text-foreground">
          {formatUSD(position.collateral + position.pnl, 0)}
        </span>
      </td>

      <td className="px-3 py-2 text-right">
        <div className="font-mono text-muted-foreground text-[10px]">
          {formatPairPrice(position.asset, position.entryPrice)}
        </div>
        <div className="font-mono text-foreground">
          {position.currentPrice > 0 ? formatPairPrice(position.asset, position.currentPrice) : '—'}
        </div>
      </td>

      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {isLiquidationRisk && <AlertTriangle className="w-3 h-3 text-primary" />}
          <span
            className={cn(
              'font-mono',
              isLiquidationRisk ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            {position.marginMode === 'Cross'
              ? <span className="text-primary text-xs">Account Level</span>
              : formatPairPrice(position.asset, position.liquidationPrice)}
          </span>
        </div>
      </td>

      {/* B8: protection at a glance — pending TP / SL triggers, '—' when unprotected */}
      <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
        <span className={protection?.tp ? 'text-long' : 'text-faint'}>
          {protection?.tp ? formatPairPrice(position.asset, protection.tp) : '—'}
        </span>
        <span className="text-faint"> / </span>
        <span className={protection?.sl ? 'text-short' : 'text-faint'}>
          {protection?.sl ? formatPairPrice(position.asset, protection.sl) : '—'}
        </span>
      </td>

      <td className="px-3 py-2 text-right">
        {/* formatPercent owns the sign (fixes the '++2.34%' double sign, A32). */}
        <div className={cn('font-mono font-medium', !hasPnl ? 'text-muted-foreground' : isPositive ? 'text-long' : 'text-short')}>
          {isPositive ? '+' : ''}{formatUSD(position.pnl)}
        </div>
        <div className={cn('font-mono text-[10px]', !hasPnl ? 'text-muted-foreground' : isPositive ? 'text-long/70' : 'text-short/70')}>
          {formatPercent(position.pnlPercent)}
        </div>
      </td>

      <td className="px-3 py-2">
        <div className="flex items-center justify-center gap-1">
          {hasSlTpCallbacks && (
            <>
              <button
                onClick={onSetStopLoss}
                disabled={isCross}
                className={cn(
                  'p-1.5 rounded-sm transition-colors',
                  isCross
                    ? 'text-muted-foreground/30 cursor-not-allowed'
                    : 'hover:bg-short/10 text-muted-foreground hover:text-short'
                )}
                title={isCross ? 'Unavailable for cross-margin positions (contract fix pending)' : 'Set Stop-Loss'}
              >
                <Shield className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onSetTakeProfit}
                disabled={isCross}
                className={cn(
                  'p-1.5 rounded-sm transition-colors',
                  isCross
                    ? 'text-muted-foreground/30 cursor-not-allowed'
                    : 'hover:bg-long/10 text-muted-foreground hover:text-long'
                )}
                title={isCross ? 'Unavailable for cross-margin positions (contract fix pending)' : 'Set Take-Profit'}
              >
                <Target className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            onClick={onShare}
            className="p-1.5 rounded-sm hover:bg-surface-3 text-muted-foreground hover:text-foreground transition-colors"
            title="Share PnL"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="h-7 px-2 rounded-sm text-[11px] font-medium border border-border-strong text-muted-foreground hover:text-short hover:border-short/40 hover:bg-surface-3 transition-colors flex items-center gap-1"
            title="Close Position"
          >
            <X className="w-3 h-3" />
            Close
          </button>
        </div>
      </td>
    </tr>
  );
}, (prev, next) => prev.isLiquidationRisk === next.isLiquidationRisk
  && prev.hasSlTpCallbacks === next.hasSlTpCallbacks
  && positionEquals(prev.position, next.position));

// Mobile card component
const PositionCard = memo(function PositionCard({
  position,
  onClose,
  onSetStopLoss,
  onSetTakeProfit,
  hasSlTpCallbacks,
  onShare,
}: {
  position: DisplayPosition;
  onClose: () => void;
  onSetStopLoss: () => void;
  onSetTakeProfit: () => void;
  hasSlTpCallbacks: boolean;
  onShare: () => void;
}) {
  // NaN pnl = mark price unknown → '—' in neutral color (see PositionRow).
  const hasPnl = Number.isFinite(position.pnl);
  const isPositive = hasPnl && position.pnl >= 0;

  return (
    <Card padding="md">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-foreground">{position.asset}-PERP</span>
            <Badge variant={position.direction === 'Long' ? 'success' : 'danger'} size="sm">
              {position.direction} {position.leverage.toFixed(0)}x
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(position.openedAt)}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <div className="text-right">
            <div className={cn('text-lg font-semibold font-mono', !hasPnl ? 'text-muted-foreground' : isPositive ? 'text-long' : 'text-short')}>
              {isPositive ? '+' : ''}{formatUSD(position.pnl)}
            </div>
            {/* formatPercent owns the sign (fixes '++2.34%', A32). */}
            <div className={cn('text-sm font-mono', !hasPnl ? 'text-muted-foreground' : isPositive ? 'text-long/70' : 'text-short/70')}>
              {formatPercent(position.pnlPercent)}
            </div>
          </div>
          <button
            onClick={onShare}
            className="p-1.5 rounded-sm hover:bg-surface-3 text-muted-foreground hover:text-foreground transition-colors"
            title="Share PnL"
          >
            <Share2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          <p className="text-muted-foreground mb-1">Size</p>
          <p className="text-foreground font-mono">{formatUSD(position.size)}</p>
        </div>
        <div>
          <p className="text-muted-foreground mb-1">Entry</p>
          <p className="text-foreground font-mono">{formatPairPrice(position.asset, position.entryPrice)}</p>
        </div>
        <div>
          <p className="text-muted-foreground mb-1">Mark</p>
          <p className="text-foreground font-mono">
            {position.currentPrice > 0 ? formatPairPrice(position.asset, position.currentPrice) : '—'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground mb-1">Liq. Price</p>
          <p className="text-primary/70 font-mono">
            {position.marginMode === 'Cross'
              ? <span className="text-primary">Account Level</span>
              : formatPairPrice(position.asset, position.liquidationPrice)}
          </p>
        </div>
      </div>

      {hasSlTpCallbacks && (
        position.marginMode === 'Cross' ? (
          <p className="mb-2 text-xs text-muted-foreground/70">
            Stop-loss / take-profit unavailable for cross-margin positions (contract fix pending)
          </p>
        ) : (
          <div className="flex gap-2 mb-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={onSetStopLoss}>
              <Shield className="w-4 h-4 mr-1" />
              Stop-Loss
            </Button>
            <Button variant="secondary" size="sm" className="flex-1" onClick={onSetTakeProfit}>
              <Target className="w-4 h-4 mr-1" />
              Take-Profit
            </Button>
          </div>
        )
      )}

      <div className="flex gap-2">
        <Button variant="danger" size="sm" className="flex-1" onClick={onClose}>
          Close
        </Button>
      </div>
    </Card>
  );
}, (prev, next) => prev.hasSlTpCallbacks === next.hasSlTpCallbacks
  && positionEquals(prev.position, next.position));
