export type StellarAddress = string;

export interface Asset {
  symbol: string;
  name: string;
  decimals: number;
}

export interface PriceData {
  price: bigint;
  timestamp: number;
}

export type Network = 'testnet' | 'mainnet' | 'futurenet';
