import { create } from 'zustand';
import type { Direction, OrderFormState } from '@/types';

interface TradeState extends OrderFormState {
  // Actions
  setAsset: (asset: string) => void;
  setDirection: (direction: Direction) => void;
  setCollateral: (collateral: string) => void;
  setLeverage: (leverage: number) => void;
  reset: () => void;
}

const defaultState: OrderFormState = {
  asset: 'BTC',
  direction: 'Long',
  collateral: '',
  leverage: 1,
};

export const useTradeStore = create<TradeState>((set) => ({
  ...defaultState,

  setAsset: (asset) => set({ asset }),
  setDirection: (direction) => set({ direction }),
  setCollateral: (collateral) => set({ collateral }),
  setLeverage: (leverage) => set({ leverage }),
  reset: () => set(defaultState),
}));
