'use client';

import { useState } from 'react';
import { Button, Card, CardContent, Input } from '@/components/ui';
import { useWalletStore } from '@/lib/store';
import {
  claimLeaderFees,
  leaderClosePosition,
  leaderOpenPosition,
} from '@/lib/stellar/vaultFactory';
import { VAULT_PRECISION } from '@/types/vault';
import toast from 'react-hot-toast';

interface Props {
  vaultId: number;
  vaultName: string;
}

const ASSETS = ['BTC', 'ETH', 'XLM'] as const;
type Asset = (typeof ASSETS)[number];
type Direction = 'Long' | 'Short';

function parseAmount(input: string): bigint | null {
  if (!input) return null;
  const m = input.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const whole = m[1] ?? '0';
  const frac = (m[2] ?? '').slice(0, 7).padEnd(7, '0');
  try {
    return BigInt(whole) * VAULT_PRECISION + BigInt(frac || '0');
  } catch {
    return null;
  }
}

export function LeaderTradePanel({ vaultId, vaultName }: Props) {
  const wallet = useWalletStore();
  const [asset, setAsset] = useState<Asset>('BTC');
  const [direction, setDirection] = useState<Direction>('Long');
  const [collateral, setCollateral] = useState('');
  const [leverage, setLeverage] = useState(2);
  const [closePositionId, setClosePositionId] = useState('');
  const [busy, setBusy] = useState(false);

  if (!wallet.address || !wallet.walletId) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-zinc-400">
          Connect a wallet to manage this vault.
        </CardContent>
      </Card>
    );
  }

  async function open() {
    const amt = parseAmount(collateral);
    if (!amt) return toast.error('Enter a valid collateral');
    setBusy(true);
    try {
      await leaderOpenPosition(wallet.address!, wallet.walletId!, {
        vaultId, asset, collateral: amt, leverage, direction,
      });
      toast.success(`Opened ${direction} ${asset} position`);
      setCollateral('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Open failed: ${msg.slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    const id = Number(closePositionId);
    if (!Number.isInteger(id) || id < 0) return toast.error('Position id must be a number');
    setBusy(true);
    try {
      await leaderClosePosition(wallet.address!, wallet.walletId!, vaultId, id);
      toast.success(`Closed position #${id}`);
      setClosePositionId('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Close failed: ${msg.slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    setBusy(true);
    try {
      await claimLeaderFees(wallet.address!, wallet.walletId!, vaultId);
      toast.success(`Claimed leader fees from ${vaultName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Claim failed: ${msg.slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-5 space-y-3">
          <h3 className="font-medium">Open position</h3>

          <div className="grid grid-cols-3 gap-2">
            {ASSETS.map((a) => (
              <Button
                key={a}
                size="sm"
                variant={asset === a ? 'primary' : 'ghost'}
                onClick={() => setAsset(a)}
              >
                {a}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant={direction === 'Long' ? 'primary' : 'ghost'}
              onClick={() => setDirection('Long')}
            >
              Long
            </Button>
            <Button
              size="sm"
              variant={direction === 'Short' ? 'primary' : 'ghost'}
              onClick={() => setDirection('Short')}
            >
              Short
            </Button>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-500 uppercase tracking-wider">
              Collateral (USDC)
            </label>
            <Input
              value={collateral}
              onChange={(e) => setCollateral(e.target.value)}
              placeholder="0.00"
              type="text"
              inputMode="decimal"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-500 uppercase tracking-wider">
              Leverage: {leverage}×
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <Button onClick={open} disabled={busy} className="w-full">
            {busy ? 'Signing…' : `Open ${direction} ${asset}`}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardContent className="p-5 space-y-3">
            <h3 className="font-medium">Close position</h3>
            <div className="space-y-1">
              <label className="text-xs text-zinc-500 uppercase tracking-wider">
                Position id
              </label>
              <Input
                value={closePositionId}
                onChange={(e) => setClosePositionId(e.target.value)}
                placeholder="42"
                type="number"
                inputMode="numeric"
              />
            </div>
            <Button onClick={close} disabled={busy} className="w-full">
              {busy ? 'Signing…' : 'Close'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <h3 className="font-medium">Claim profit share</h3>
            <p className="text-xs text-zinc-400">
              Pulls 10% of any NAV gain above the high-water mark to your
              wallet. HWM resets afterward — no double-claiming the same gain.
            </p>
            <Button onClick={claim} disabled={busy} className="w-full">
              {busy ? 'Signing…' : 'Claim'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
