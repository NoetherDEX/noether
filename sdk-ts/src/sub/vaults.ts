import type { Transport } from '../transport.js';

export interface VaultRow {
  id: number;
  leader: string;
  name: string;
  createdAt: number;
  totalUsdc: string;
  circulatingShares: string;
  hwmNav: string;
  realizedPnl: string;
  leaderShares: string;
  profitShareBps: number;
  paused: boolean;
  updatedAt: number;
}

export interface VaultActivityRow {
  id: number;
  vaultId: number;
  principal: string;
  amount: string;
  shares?: string;
  ledger: number;
  ts: number;
  txHash: string;
}

export interface VaultTradeRow {
  id: number;
  vaultId: number;
  positionId: string;
  action: 'open' | 'close';
  leader: string;
  collateral: string;
  /** Settled PnL on close rows (7-dec USDC, signed); null on open rows. */
  pnl?: string | null;
  ledger: number;
  ts: number;
  txHash: string;
}

export interface VaultListQuery {
  leader?: string;
  limit?: number;
}

export interface VaultActivityQuery {
  limit?: number;
}

export class VaultsApi {
  constructor(private readonly transport: Transport) {}

  async list(query: VaultListQuery = {}): Promise<VaultRow[]> {
    const res = await this.transport.request<{ vaults: VaultRow[] }>({
      path: '/v1/vaults',
      query: { leader: query.leader, limit: query.limit },
    });
    return res.vaults;
  }

  async get(id: number): Promise<VaultRow> {
    return this.transport.request<VaultRow>({ path: `/v1/vaults/${id}` });
  }

  async trades(id: number, query: VaultActivityQuery = {}): Promise<VaultTradeRow[]> {
    const res = await this.transport.request<{ trades: VaultTradeRow[] }>({
      path: `/v1/vaults/${id}/trades`,
      query: { limit: query.limit },
    });
    return res.trades;
  }

  async deposits(id: number, query: VaultActivityQuery = {}): Promise<VaultActivityRow[]> {
    const res = await this.transport.request<{ deposits: VaultActivityRow[] }>({
      path: `/v1/vaults/${id}/deposits`,
      query: { limit: query.limit },
    });
    return res.deposits;
  }

  async withdraws(id: number, query: VaultActivityQuery = {}): Promise<VaultActivityRow[]> {
    const res = await this.transport.request<{ withdraws: VaultActivityRow[] }>({
      path: `/v1/vaults/${id}/withdraws`,
      query: { limit: query.limit },
    });
    return res.withdraws;
  }

  async feeClaims(id: number, query: VaultActivityQuery = {}): Promise<VaultActivityRow[]> {
    const res = await this.transport.request<{ feeClaims: VaultActivityRow[] }>({
      path: `/v1/vaults/${id}/fee-claims`,
      query: { limit: query.limit },
    });
    return res.feeClaims;
  }
}
