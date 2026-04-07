'use client';

import { useState } from 'react';
import { TrendingUp, X, RefreshCw, Share2, AlertTriangle, Shield, Target } from 'lucide-react';
import { Button, Badge, Modal, Card } from '@/components/ui';
import { formatUSD, formatPrice, formatPercent, formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import type { DisplayPosition, PnlShareData } from '@/types';
import { PnlShareModal } from '@/components/share/PnlShareModal';

interface PositionsListProps {
  positions: DisplayPosition[];
  isLoading?: boolean;
  isRefreshing?: boolean;
  onClosePosition?: (id: number) => Promise<void>;
  onSetStopLoss?: (id: number, triggerPrice: number, slippageBps: number) => Promise<void>;
  onSetTakeProfit?: (id: number, triggerPrice: number, slippageBps: number) => Promise<void>;
  onRefresh?: () => void;
}

export function PositionsList({
  positions,
  isLoading,
  isRefreshing,
  onClosePosition,
  onSetStopLoss,
  onSetTakeProfit,
  onRefresh,
}: PositionsListProps) {
  const [selectedPosition, setSelectedPosition] = useState<DisplayPosition | null>(null);
  const [actionModal, setActionModal] = useState<'close' | 'stop-loss' | 'take-profit' | null>(null);
  const [slTpPrice, setSlTpPrice] = useState('');
  const [slTpSlippage, setSlTpSlippage] = useState(50); // 0.5% default
  const [customSlTpSlippage, setCustomSlTpSlippage] = useState('');
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
            className="h-16 bg-zinc-900/50 rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="relative mb-4">
          <div className="w-16 h-16 rounded-full bg-white/[0.04] flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-muted-foreground/50" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-card border border-white/10 flex items-center justify-center">
            <span className="text-muted-foreground/50 text-xs font-mono">0</span>
          </div>
        </div>
        <h3 className="text-foreground font-medium mb-1">No open positions</h3>
        <p className="text-muted-foreground text-sm text-center max-w-xs">
          Open a position to start trading. Your active trades will appear here.
        </p>
        <button className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-[#eab308] text-black hover:opacity-90 transition-opacity">
          Start Trading
        </button>
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
      await onSetTakeProfit(selectedPosition.id, parseFloat(slTpPrice), slTpSlippage);
      setActionModal(null);
      setSelectedPosition(null);
      setSlTpPrice('');
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
                'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all',
                'text-muted-foreground hover:text-foreground hover:bg-zinc-900/50',
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
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-muted-foreground border-b border-white/5">
              <th className="text-left px-3 py-2.5 font-medium">Market</th>
              <th className="text-right px-3 py-2.5 font-medium">Size</th>
              <th className="text-right px-3 py-2.5 font-medium">Net Value</th>
              <th className="text-right px-3 py-2.5 font-medium">Entry / Mark</th>
              <th className="text-right px-3 py-2.5 font-medium">Liq. Price</th>
              <th className="text-right px-3 py-2.5 font-medium">PnL</th>
              <th className="text-center px-3 py-2.5 font-medium">Actions</th>
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
                  setSlTpPrice(suggestedSL.toFixed(position.asset === 'XLM' ? 4 : 2));
                  setActionModal('stop-loss');
                }}
                onSetTakeProfit={() => {
                  setSelectedPosition(position);
                  // Suggest a take-profit 10% above entry for long, 10% below for short
                  const suggestedTP = position.direction === 'Long'
                    ? position.entryPrice * 1.10
                    : position.entryPrice * 0.90;
                  setSlTpPrice(suggestedTP.toFixed(position.asset === 'XLM' ? 4 : 2));
                  setActionModal('take-profit');
                }}
                hasSlTpCallbacks={!!onSetStopLoss && !!onSetTakeProfit}
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
              setSlTpPrice(suggestedSL.toFixed(position.asset === 'XLM' ? 4 : 2));
              setActionModal('stop-loss');
            }}
            onSetTakeProfit={() => {
              setSelectedPosition(position);
              const suggestedTP = position.direction === 'Long'
                ? position.entryPrice * 1.10
                : position.entryPrice * 0.90;
              setSlTpPrice(suggestedTP.toFixed(position.asset === 'XLM' ? 4 : 2));
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
            <div className="mb-6 p-4 bg-zinc-900/50 rounded-xl space-y-2">
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
                <span className={selectedPosition.pnl >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}>
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
        {selectedPosition && (
          <div>
            <div className="mb-6 p-4 bg-zinc-900/50 rounded-xl space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Position</span>
                <span className="text-foreground">
                  {selectedPosition.asset} {selectedPosition.direction}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Entry Price</span>
                <span className="text-foreground">{formatUSD(selectedPosition.entryPrice, 2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Current Price</span>
                <span className="text-foreground">{formatUSD(selectedPosition.currentPrice, 2)}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-sm text-muted-foreground mb-2 block">
                Trigger Price (USD)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.0001"
                  value={slTpPrice}
                  onChange={(e) => setSlTpPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-zinc-900/50 border border-white/10 rounded-md px-3 py-3 text-right font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-[#ef4444] focus:border-[#ef4444] transition-colors pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">USD</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedPosition.direction === 'Long'
                  ? 'Position closes when price drops to this level'
                  : 'Position closes when price rises to this level'}
              </p>
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground">
                  Slippage Tolerance
                </label>
                <span className="text-xs font-mono text-foreground">
                  {(slTpSlippage / 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex gap-2">
                {[50, 100, 200].map((bps) => (
                  <button
                    key={bps}
                    onClick={() => {
                      setSlTpSlippage(bps);
                      setCustomSlTpSlippage('');
                    }}
                    className={cn(
                      'flex-1 py-2 text-xs font-medium rounded border transition-all',
                      slTpSlippage === bps && customSlTpSlippage === ''
                        ? 'bg-[#ef4444]/20 border-[#ef4444]/50 text-[#ef4444]'
                        : 'border-white/10 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {(bps / 100).toFixed(1)}%
                  </button>
                ))}
                <div className="relative flex-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={customSlTpSlippage}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      setCustomSlTpSlippage(val);
                      const parsed = parseFloat(val);
                      if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
                        setSlTpSlippage(Math.round(parsed * 100));
                      }
                    }}
                    placeholder="Custom"
                    className={cn(
                      'w-full bg-zinc-900/50 border rounded-md px-2 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-[#ef4444] focus:border-[#ef4444] transition-colors pr-5',
                      customSlTpSlippage !== ''
                        ? 'border-[#ef4444]/50'
                        : 'border-white/10'
                    )}
                  />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Order cancelled if execution price differs by more than this (default: 0.5%)
              </p>
            </div>

            {/* Validation warning */}
            {slTpPrice && selectedPosition && (() => {
              const price = parseFloat(slTpPrice);
              const isLong = selectedPosition.direction === 'Long';
              const invalid = isLong ? price >= selectedPosition.entryPrice : price <= selectedPosition.entryPrice;
              return invalid ? (
                <div className="mb-4 p-3 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#ef4444] mt-0.5 shrink-0" />
                  <p className="text-xs text-[#ef4444]">
                    {isLong
                      ? 'Stop-loss must be below entry price for Long positions'
                      : 'Stop-loss must be above entry price for Short positions'}
                  </p>
                </div>
              ) : null;
            })()}

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setActionModal(null)}
                disabled={isSettingSLTP}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={handleSetStopLoss}
                disabled={!slTpPrice || isSettingSLTP || (() => {
                  const price = parseFloat(slTpPrice);
                  const isLong = selectedPosition?.direction === 'Long';
                  return isLong ? price >= (selectedPosition?.entryPrice ?? 0) : price <= (selectedPosition?.entryPrice ?? 0);
                })()}
                isLoading={isSettingSLTP}
              >
                <Shield className="w-4 h-4 mr-1" />
                Set Stop-Loss
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Take-Profit Modal */}
      <Modal
        isOpen={actionModal === 'take-profit'}
        onClose={() => setActionModal(null)}
        title="Set Take-Profit"
        size="sm"
      >
        {selectedPosition && (
          <div>
            <div className="mb-6 p-4 bg-zinc-900/50 rounded-xl space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Position</span>
                <span className="text-foreground">
                  {selectedPosition.asset} {selectedPosition.direction}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Entry Price</span>
                <span className="text-foreground">{formatUSD(selectedPosition.entryPrice, 2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Current Price</span>
                <span className="text-foreground">{formatUSD(selectedPosition.currentPrice, 2)}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-sm text-muted-foreground mb-2 block">
                Trigger Price (USD)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.0001"
                  value={slTpPrice}
                  onChange={(e) => setSlTpPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-zinc-900/50 border border-white/10 rounded-md px-3 py-3 text-right font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-[#22c55e] focus:border-[#22c55e] transition-colors pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">USD</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedPosition.direction === 'Long'
                  ? 'Position closes when price rises to this level'
                  : 'Position closes when price drops to this level'}
              </p>
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground">
                  Slippage Tolerance
                </label>
                <span className="text-xs font-mono text-foreground">
                  {(slTpSlippage / 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex gap-2">
                {[50, 100, 200].map((bps) => (
                  <button
                    key={bps}
                    onClick={() => {
                      setSlTpSlippage(bps);
                      setCustomSlTpSlippage('');
                    }}
                    className={cn(
                      'flex-1 py-2 text-xs font-medium rounded border transition-all',
                      slTpSlippage === bps && customSlTpSlippage === ''
                        ? 'bg-[#22c55e]/20 border-[#22c55e]/50 text-[#22c55e]'
                        : 'border-white/10 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {(bps / 100).toFixed(1)}%
                  </button>
                ))}
                <div className="relative flex-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={customSlTpSlippage}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      setCustomSlTpSlippage(val);
                      const parsed = parseFloat(val);
                      if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
                        setSlTpSlippage(Math.round(parsed * 100));
                      }
                    }}
                    placeholder="Custom"
                    className={cn(
                      'w-full bg-zinc-900/50 border rounded-md px-2 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-[#22c55e] focus:border-[#22c55e] transition-colors pr-5',
                      customSlTpSlippage !== ''
                        ? 'border-[#22c55e]/50'
                        : 'border-white/10'
                    )}
                  />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Order cancelled if execution price differs by more than this (default: 0.5%)
              </p>
            </div>

            {/* Validation warning */}
            {slTpPrice && selectedPosition && (() => {
              const price = parseFloat(slTpPrice);
              const isLong = selectedPosition.direction === 'Long';
              const invalid = isLong ? price <= selectedPosition.entryPrice : price >= selectedPosition.entryPrice;
              return invalid ? (
                <div className="mb-4 p-3 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#ef4444] mt-0.5 shrink-0" />
                  <p className="text-xs text-[#ef4444]">
                    {isLong
                      ? 'Take-profit must be above entry price for Long positions'
                      : 'Take-profit must be below entry price for Short positions'}
                  </p>
                </div>
              ) : null;
            })()}

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setActionModal(null)}
                disabled={isSettingSLTP}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={handleSetTakeProfit}
                disabled={!slTpPrice || isSettingSLTP || (() => {
                  const price = parseFloat(slTpPrice);
                  const isLong = selectedPosition?.direction === 'Long';
                  return isLong ? price <= (selectedPosition?.entryPrice ?? 0) : price >= (selectedPosition?.entryPrice ?? 0);
                })()}
                isLoading={isSettingSLTP}
              >
                <Target className="w-4 h-4 mr-1" />
                Set Take-Profit
              </Button>
            </div>
          </div>
        )}
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
function PositionRow({
  position,
  isLiquidationRisk,
  onClose,
  onSetStopLoss,
  onSetTakeProfit,
  hasSlTpCallbacks,
  onShare,
}: {
  position: DisplayPosition;
  isLiquidationRisk: boolean;
  onClose: () => void;
  onSetStopLoss: () => void;
  onSetTakeProfit: () => void;
  hasSlTpCallbacks: boolean;
  onShare: () => void;
}) {
  const isPositive = position.pnl >= 0;


  return (
    <tr className="border-b border-white/5 hover:bg-zinc-900/50 transition-colors">
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{position.asset}-PERP</span>
          <span
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-bold font-mono',
              position.direction === 'Long'
                ? 'bg-[#22c55e]/15 text-[#22c55e] ring-1 ring-[#22c55e]/30'
                : 'bg-[#ef4444]/15 text-[#ef4444] ring-1 ring-[#ef4444]/30'
            )}
          >
            {position.leverage.toFixed(0)}x
          </span>
        </div>
        <span
          className={cn(
            'text-[10px] font-medium',
            position.direction === 'Long' ? 'text-[#22c55e]' : 'text-[#ef4444]'
          )}
        >
          {position.direction.toUpperCase()}
          {position.marginMode === 'Cross' && (
            <span className="ml-1 text-[8px] px-1 py-0.5 bg-amber-500/20 text-amber-500 rounded">CROSS</span>
          )}
        </span>
      </td>

      <td className="px-3 py-3 text-right">
        <div className="font-mono text-foreground">
          ${position.size.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
        <div className="font-mono text-muted-foreground text-[10px]">
          {position.collateral.toFixed(2)} USDC
        </div>
      </td>

      <td className="px-3 py-3 text-right">
        <span className="font-mono text-foreground">
          ${(position.collateral + position.pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </td>

      <td className="px-3 py-3 text-right">
        <div className="font-mono text-muted-foreground text-[10px]">
          {formatPrice(position.entryPrice)}
        </div>
        <div className="font-mono text-foreground">
          {formatPrice(position.currentPrice)}
        </div>
      </td>

      <td className="px-3 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {isLiquidationRisk && <AlertTriangle className="w-3 h-3 text-[#f97316]" />}
          <span
            className={cn(
              'font-mono',
              isLiquidationRisk ? 'text-[#f97316]' : 'text-muted-foreground'
            )}
          >
            {position.marginMode === 'Cross'
              ? <span className="text-amber-500 text-xs">Account Level</span>
              : formatPrice(position.liquidationPrice)}
          </span>
        </div>
      </td>

      <td className="px-3 py-3 text-right">
        <div className={cn('font-mono font-medium', isPositive ? 'text-[#22c55e]' : 'text-[#ef4444]')}>
          {isPositive ? '+' : ''}{formatUSD(position.pnl)}
        </div>
        <div className={cn('font-mono text-[10px]', isPositive ? 'text-[#22c55e]/70' : 'text-[#ef4444]/70')}>
          {isPositive ? '+' : ''}{formatPercent(position.pnlPercent)}
        </div>
      </td>

      <td className="px-3 py-3">
        <div className="flex items-center justify-center gap-1">
          {hasSlTpCallbacks && (
            <>
              <button
                onClick={onSetStopLoss}
                className="p-1.5 rounded hover:bg-[#ef4444]/10 text-muted-foreground hover:text-[#ef4444] transition-colors"
                title="Set Stop-Loss"
              >
                <Shield className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onSetTakeProfit}
                className="p-1.5 rounded hover:bg-[#22c55e]/10 text-muted-foreground hover:text-[#22c55e] transition-colors"
                title="Set Take-Profit"
              >
                <Target className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            onClick={onShare}
            className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Share PnL"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="px-2.5 py-1 rounded text-[10px] font-medium bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors flex items-center gap-1"
            title="Close Position"
          >
            <X className="w-3 h-3" />
            Close
          </button>
        </div>
      </td>
    </tr>
  );
}

// Mobile card component
function PositionCard({
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
  const isPositive = position.pnl >= 0;

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
            <div className={cn('text-lg font-semibold font-mono', isPositive ? 'text-[#22c55e]' : 'text-[#ef4444]')}>
              {isPositive ? '+' : ''}{formatUSD(position.pnl)}
            </div>
            <div className={cn('text-sm font-mono', isPositive ? 'text-[#22c55e]/70' : 'text-[#ef4444]/70')}>
              {isPositive ? '+' : ''}{formatPercent(position.pnlPercent)}
            </div>
          </div>
          <button
            onClick={onShare}
            className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
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
          <p className="text-foreground font-mono">{formatPrice(position.entryPrice)}</p>
        </div>
        <div>
          <p className="text-muted-foreground mb-1">Mark</p>
          <p className="text-foreground font-mono">{formatPrice(position.currentPrice)}</p>
        </div>
        <div>
          <p className="text-muted-foreground mb-1">Liq. Price</p>
          <p className="text-[#f97316]/70 font-mono">
            {position.marginMode === 'Cross'
              ? <span className="text-amber-500">Account Level</span>
              : formatPrice(position.liquidationPrice)}
          </p>
        </div>
      </div>

      {hasSlTpCallbacks && (
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
      )}

      <div className="flex gap-2">
        <Button variant="danger" size="sm" className="flex-1" onClick={onClose}>
          Close
        </Button>
      </div>
    </Card>
  );
}
