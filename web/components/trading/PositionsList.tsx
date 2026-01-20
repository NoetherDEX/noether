'use client';

import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, MoreHorizontal, X, Plus, RefreshCw } from 'lucide-react';
import { Button, Badge, Modal, Card } from '@/components/ui';
import { formatUSD, formatPercent, formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import type { DisplayPosition } from '@/types';

interface PositionsListProps {
  positions: DisplayPosition[];
  isLoading?: boolean;
  isRefreshing?: boolean;
  onClosePosition?: (id: number) => Promise<void>;
  onAddCollateral?: (id: number, amount: number) => void;
  onRefresh?: () => void;
}

export function PositionsList({
  positions,
  isLoading,
  isRefreshing,
  onClosePosition,
  onAddCollateral,
  onRefresh,
}: PositionsListProps) {
  const [selectedPosition, setSelectedPosition] = useState<DisplayPosition | null>(null);
  const [actionModal, setActionModal] = useState<'close' | 'add-collateral' | null>(null);
  const [addCollateralAmount, setAddCollateralAmount] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 bg-white/5 rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
          <TrendingUp className="w-8 h-8 text-neutral-600" />
        </div>
        <h3 className="text-lg font-medium text-neutral-300 mb-2">
          No Open Positions
        </h3>
        <p className="text-sm text-neutral-500">
          Open your first position to start trading
        </p>
      </div>
    );
  }

  const handleClose = async () => {
    if (!selectedPosition || !onClosePosition || isClosing) return;

    setIsClosing(true);
    try {
      await onClosePosition(selectedPosition.id);
      // Only close modal after successful transaction
      setActionModal(null);
      setSelectedPosition(null);
    } catch (error) {
      console.error('Failed to close position:', error);
      // Keep modal open on error so user can retry
    } finally {
      setIsClosing(false);
    }
  };

  const handleAddCollateral = () => {
    if (selectedPosition && onAddCollateral && addCollateralAmount) {
      onAddCollateral(selectedPosition.id, parseFloat(addCollateralAmount));
    }
    setActionModal(null);
    setSelectedPosition(null);
    setAddCollateralAmount('');
  };

  return (
    <>
      {/* Header with Refresh Button */}
      {positions.length > 0 && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-neutral-500">
            {positions.length} open position{positions.length !== 1 ? 's' : ''}
          </span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all',
                'text-neutral-400 hover:text-white hover:bg-white/5',
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
        <table className="w-full">
          <thead>
            <tr className="text-xs text-neutral-500 border-b border-white/5">
              <th className="text-left py-3 px-4 font-medium">ID</th>
              <th className="text-left py-3 px-4 font-medium">Asset</th>
              <th className="text-left py-3 px-4 font-medium">Side</th>
              <th className="text-right py-3 px-4 font-medium">Size</th>
              <th className="text-right py-3 px-4 font-medium">Entry</th>
              <th className="text-right py-3 px-4 font-medium">Mark</th>
              <th className="text-right py-3 px-4 font-medium">PnL</th>
              <th className="text-right py-3 px-4 font-medium">Liq. Price</th>
              <th className="text-right py-3 px-4 font-medium">Opened</th>
              <th className="text-right py-3 px-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <PositionRow
                key={position.id}
                position={position}
                onClose={() => {
                  setSelectedPosition(position);
                  setActionModal('close');
                }}
                onAddCollateral={() => {
                  setSelectedPosition(position);
                  setActionModal('add-collateral');
                }}
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
            onAddCollateral={() => {
              setSelectedPosition(position);
              setActionModal('add-collateral');
            }}
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
            <div className="mb-6 p-4 bg-white/5 rounded-xl space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-neutral-400">Position</span>
                <span className="text-white">
                  {selectedPosition.asset} {selectedPosition.direction}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-neutral-400">Size</span>
                <span className="text-white">{formatUSD(selectedPosition.size)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-neutral-400">Unrealized PnL</span>
                <span className={selectedPosition.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
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

      {/* Add Collateral Modal */}
      <Modal
        isOpen={actionModal === 'add-collateral'}
        onClose={() => setActionModal(null)}
        title="Add Collateral"
        size="sm"
      >
        {selectedPosition && (
          <div>
            <div className="mb-6">
              <p className="text-sm text-neutral-400 mb-4">
                Adding collateral will lower your liquidation price and reduce risk.
              </p>
              <input
                type="number"
                value={addCollateralAmount}
                onChange={(e) => setAddCollateralAmount(e.target.value)}
                placeholder="Amount (XLM)"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setActionModal(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={handleAddCollateral}
                disabled={!addCollateralAmount}
              >
                Add Collateral
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// Table row component
function PositionRow({
  position,
  onClose,
  onAddCollateral,
}: {
  position: DisplayPosition;
  onClose: () => void;
  onAddCollateral: () => void;
}) {
  const isPositive = position.pnl >= 0;

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
      <td className="py-4 px-4">
        <span className="text-neutral-400 font-mono text-sm">#{position.id}</span>
      </td>
      <td className="py-4 px-4">
        <span className="font-medium text-white">{position.asset}/USD</span>
      </td>
      <td className="py-4 px-4">
        <Badge variant={position.direction === 'Long' ? 'success' : 'danger'}>
          {position.direction} {position.leverage.toFixed(1)}x
        </Badge>
      </td>
      <td className="py-4 px-4 text-right text-white">
        {formatUSD(position.size)}
      </td>
      <td className="py-4 px-4 text-right text-neutral-300">
        {formatUSD(position.entryPrice, position.asset === 'XLM' ? 4 : 2)}
      </td>
      <td className="py-4 px-4 text-right text-white">
        {formatUSD(position.currentPrice, position.asset === 'XLM' ? 4 : 2)}
      </td>
      <td className="py-4 px-4 text-right">
        <div className={cn('font-medium', isPositive ? 'text-emerald-400' : 'text-red-400')}>
          {formatUSD(position.pnl)}
        </div>
        <div className={cn('text-xs', isPositive ? 'text-emerald-400/70' : 'text-red-400/70')}>
          {formatPercent(position.pnlPercent)}
        </div>
      </td>
      <td className="py-4 px-4 text-right text-neutral-400">
        {formatUSD(position.liquidationPrice, position.asset === 'XLM' ? 4 : 2)}
      </td>
      <td className="py-4 px-4 text-right text-neutral-400 text-sm">
        {formatDateTime(position.openedAt)}
      </td>
      <td className="py-4 px-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onAddCollateral}
            className="p-2 text-neutral-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            title="Add Collateral"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            title="Close Position"
          >
            <X className="w-4 h-4" />
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
  onAddCollateral,
}: {
  position: DisplayPosition;
  onClose: () => void;
  onAddCollateral: () => void;
}) {
  const isPositive = position.pnl >= 0;

  return (
    <Card padding="md">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-neutral-400 font-mono text-xs">#{position.id}</span>
            <span className="font-semibold text-white">{position.asset}/USD</span>
            <Badge variant={position.direction === 'Long' ? 'success' : 'danger'} size="sm">
              {position.direction} {position.leverage.toFixed(1)}x
            </Badge>
          </div>
          <p className="text-xs text-neutral-500">
            {formatDateTime(position.openedAt)}
          </p>
        </div>
        <div className="text-right">
          <div className={cn('text-lg font-semibold', isPositive ? 'text-emerald-400' : 'text-red-400')}>
            {formatUSD(position.pnl)}
          </div>
          <div className={cn('text-sm', isPositive ? 'text-emerald-400/70' : 'text-red-400/70')}>
            {formatPercent(position.pnlPercent)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          <p className="text-neutral-500 mb-1">Size</p>
          <p className="text-white">{formatUSD(position.size)}</p>
        </div>
        <div>
          <p className="text-neutral-500 mb-1">Entry</p>
          <p className="text-white">{formatUSD(position.entryPrice, 2)}</p>
        </div>
        <div>
          <p className="text-neutral-500 mb-1">Mark</p>
          <p className="text-white">{formatUSD(position.currentPrice, 2)}</p>
        </div>
        <div>
          <p className="text-neutral-500 mb-1">Liq. Price</p>
          <p className="text-red-400/70">{formatUSD(position.liquidationPrice, 2)}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" className="flex-1" onClick={onAddCollateral}>
          <Plus className="w-4 h-4 mr-1" />
          Add Collateral
        </Button>
        <Button variant="danger" size="sm" className="flex-1" onClick={onClose}>
          Close
        </Button>
      </div>
    </Card>
  );
}
