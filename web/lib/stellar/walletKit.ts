/**
 * Wallet Kit singleton — all imports from @creit-tech/stellar-wallets-kit are
 * dynamic to prevent Preact / Twind / signal side-effects from running at
 * module-load time and interfering with the Next.js React app.
 */

export const WALLETCONNECT_ID = 'wallet_connect';

export interface SupportedWallet {
  id: string;
  name: string;
  icon: string;
  url: string;
  isAvailable: boolean;
}

let initialized = false;

async function getKit() {
  const { StellarWalletsKit } = await import('@creit-tech/stellar-wallets-kit/sdk');
  if (!initialized) {
    const { defaultModules } = await import('@creit-tech/stellar-wallets-kit/modules/utils');

    const modules = [...defaultModules()];

    // Add WalletConnect module for mobile wallet support (LOBSTR, etc.)
    const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    if (wcProjectId) {
      try {
        const { WalletConnectModule, WalletConnectTargetChain } = await import(
          '@creit-tech/stellar-wallets-kit/modules/wallet-connect'
        );
        modules.push(
          new WalletConnectModule({
            projectId: wcProjectId,
            metadata: {
              name: 'Noether Exchange',
              description: 'Decentralized Perpetual Exchange on Stellar',
              url: 'https://noether.exchange',
              icons: ['https://noether.exchange/favicon.svg'],
            },
            allowedChains: [WalletConnectTargetChain.TESTNET],
          })
        );
        console.log('[WalletKit] WalletConnect module loaded');
      } catch (err) {
        console.error('[WalletKit] Failed to load WalletConnect module:', err);
      }
    } else {
      console.warn('[WalletKit] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID not set, skipping WalletConnect');
    }

    StellarWalletsKit.init({ modules });
    initialized = true;
  }
  return StellarWalletsKit;
}

export async function initWalletKit() {
  await getKit();
}

export async function getSupportedWallets(): Promise<SupportedWallet[]> {
  const kit = await getKit();
  const wallets = await kit.refreshSupportedWallets();
  return wallets.map((w) => ({
    id: w.id,
    name: w.name,
    icon: w.icon,
    url: w.url,
    isAvailable: w.isAvailable,
  }));
}

export async function connectWallet(walletId: string): Promise<{ address: string }> {
  const kit = await getKit();
  kit.setWallet(walletId);

  // Set the internal state the same way the kit's authModal does
  const { activeAddress, activeModule } = await import('@creit-tech/stellar-wallets-kit/state');
  const { address } = await activeModule.value!.getAddress();
  activeAddress.value = address;

  return { address };
}

export async function getWalletAddress(): Promise<{ address: string }> {
  const kit = await getKit();
  return kit.getAddress();
}

export async function signWithWallet(
  xdr: string,
  opts: { networkPassphrase: string; address: string }
): Promise<string> {
  const kit = await getKit();
  const { signedTxXdr } = await kit.signTransaction(xdr, opts);
  return signedTxXdr;
}

export async function disconnectWallet(): Promise<void> {
  try {
    const kit = await getKit();
    await kit.disconnect();
  } catch {
    // Some wallets may not support disconnect — ignore
  }
}
