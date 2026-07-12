'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Users, User } from 'lucide-react';
import { useWallet } from '@/lib/hooks/useWallet';
import { useLeaderModeStore } from '@/lib/store';
import { listVaults } from '@/lib/api/vaults';
import { cn } from '@/lib/utils/cn';
import { VAULT_PRECISION } from '@/types/vault';
import type { VaultRow } from '@/types/vault';

function fmtUsdc(raw: string, dp = 2): string {
  const value = BigInt(raw);
  const whole = value / VAULT_PRECISION;
  const frac = value % VAULT_PRECISION;
  const fracStr = frac.toString().padStart(7, '0').slice(0, dp);
  return `${whole}.${fracStr}`;
}

export function LeaderModeSelector() {
  const { publicKey, isConnected } = useWallet();
  const { vault, setVault } = useLeaderModeStore();
  const [vaults, setVaults] = useState<VaultRow[]>([]);
  const [open, setOpen] = useState(false);

  // Refresh the led-vault list on mount and every 10s so the
  // dropdown + selected balance line stay in sync after deposits,
  // withdrawals, and the leader's own trades. We intentionally do
  // *not* depend on the full `vault` object — setVault writes a new
  // reference every poll, which would otherwise self-trigger.
  useEffect(() => {
    if (!isConnected || !publicKey) {
      setVaults([]);
      if (useLeaderModeStore.getState().vault) setVault(null);
      return;
    }
    const tick = () => {
      listVaults({ leader: publicKey, limit: 50 })
        .then((rows) => {
          setVaults(rows);
          const current = useLeaderModeStore.getState().vault;
          if (current) {
            const fresh = rows.find((v) => v.id === current.id);
            if (fresh) setVault(fresh);
            else setVault(null);
          }
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [publicKey, isConnected, setVault]);

  if (!isConnected) return null;
  if (vaults.length === 0 && !vault) return null;

  return (
    <div className="relative border-b border-border bg-surface-2/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {vault ? (
            <Users className="w-4 h-4 text-primary shrink-0" />
          ) : (
            <User className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-faint">
              Trading as
            </div>
            <div className="text-sm font-medium truncate">
              {vault ? `Leader of ${vault.name}` : 'Personal wallet'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-surface-3 transition-colors shrink-0"
        >
          Switch
          <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {vault && (
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
          <span className="text-faint">Vault balance</span>
          <span className="text-primary font-mono font-medium">
            {fmtUsdc(vault.totalUsdc)} USDC
          </span>
        </div>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 z-30 rounded-lg border border-border-strong bg-surface-2 overflow-hidden">
          <button
            type="button"
            onClick={() => {
              setVault(null);
              setOpen(false);
            }}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-surface-3 transition-colors',
              !vault && 'bg-surface-3/50',
            )}
          >
            <User className="w-4 h-4 text-muted-foreground" />
            <div>
              <div>Personal wallet</div>
              <div className="text-[11px] text-faint">
                Trade with your own balance
              </div>
            </div>
          </button>
          {vaults.length > 0 && (
            <div className="border-t border-border">
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-faint">
                Vaults you lead
              </div>
              {vaults.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    setVault(v);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-surface-3 transition-colors',
                    vault?.id === v.id && 'bg-surface-3/50',
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Users className="w-4 h-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate">{v.name}</div>
                      <div className="text-[11px] font-mono text-faint">
                        #{v.id} · {fmtUsdc(v.totalUsdc)} USDC
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {vaults.length === 0 && (
            <div className="px-4 py-3 text-xs text-faint border-t border-border">
              You don't lead any vaults yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
