import type { Network } from '@noether/types';

export const NETWORK_PASSPHRASES: Record<Network, string> = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
  futurenet: 'Test SDF Future Network ; October 2022',
};

export function getNetworkPassphrase(network: Network): string {
  const passphrase = NETWORK_PASSPHRASES[network];
  if (!passphrase) {
    throw new Error(`Unknown network: ${network}`);
  }
  return passphrase;
}

export const DEFAULT_RPC_URLS: Record<Network, string> = {
  testnet: 'https://soroban-testnet.stellar.org',
  mainnet: 'https://mainnet.sorobanrpc.com',
  futurenet: 'https://rpc-futurenet.stellar.org',
};

export const DEFAULT_HORIZON_URLS: Record<Network, string> = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
  futurenet: 'https://horizon-futurenet.stellar.org',
};
