/**
 * Wallet Kit singleton — all imports from @creit-tech/stellar-wallets-kit are
 * dynamic to prevent Preact / Twind / signal side-effects from running at
 * module-load time and interfering with the Next.js React app.
 */

import { isWalletRejection, WALLET_REJECTION_MESSAGE } from '@/lib/utils/contractErrors';

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

export async function connectWallet(walletId: string): Promise<{ address: string; walletId: string }> {
  const kit = await getKit();
  kit.setWallet(walletId);

  // Set the internal state the same way the kit's authModal does
  const { activeAddress, activeModule } = await import('@creit-tech/stellar-wallets-kit/state');
  const { address } = await activeModule.value!.getAddress();
  activeAddress.value = address;

  return { address, walletId };
}

export async function getWalletAddress(): Promise<{ address: string }> {
  const kit = await getKit();
  return kit.getAddress();
}

/**
 * Set up a wallet module and active address for future signing.
 * Does NOT call getAddress() — no extension popup.
 * Call this after restoring from persisted store to prepare the kit for signing.
 */
export async function setupWalletModule(walletId: string, address: string): Promise<void> {
  const kit = await getKit();
  kit.setWallet(walletId);
  const { activeAddress } = await import('@creit-tech/stellar-wallets-kit/state');
  activeAddress.value = address;
}

/**
 * Restore a previous wallet session by re-selecting the module.
 * For WalletConnect, restores from localStorage session data (no QR modal).
 * For extensions (Freighter, etc.), restores silently from stored address.
 */
export async function restoreWalletSession(
  walletId: string,
  storedAddress?: string | null
): Promise<{ address: string } | null> {
  const kit = await getKit();
  kit.setWallet(walletId);

  const { activeModule, activeAddress } = await import('@creit-tech/stellar-wallets-kit/state');
  const mod = activeModule.value;
  if (!mod) return null;

  // WalletConnect: restore from persisted session data without opening QR modal
  if (walletId === WALLETCONNECT_ID) {
    try {
      // wcSessionPaths is auto-restored from localStorage on module load
      const { wcSessionPaths } = await import('@creit-tech/stellar-wallets-kit/state');
      const paths = wcSessionPaths.value;

      if (!paths || paths.length === 0 || !storedAddress) {
        return null; // No persisted session
      }

      // Check if the stored address has a matching session path
      const hasSession = paths.some((p: { publicKey: string }) => p.publicKey === storedAddress);
      if (!hasSession) {
        return null; // Session expired or doesn't match
      }

      // Wait for signClient to be ready (it inits async in constructor)
      let retries = 0;
      while (!(await mod.isAvailable()) && retries < 20) {
        await new Promise(r => setTimeout(r, 250));
        retries++;
      }

      if (!(await mod.isAvailable())) {
        return null; // signClient never initialized
      }

      // Set activeAddress so signTransaction can find the right session
      activeAddress.value = storedAddress;
      return { address: storedAddress };
    } catch {
      return null;
    }
  }

  // Extension wallets (Freighter, xBull, etc.): restore silently from stored address
  // Do NOT call getAddress() here — it triggers the extension popup on page load.
  // The address was already verified when the user first connected.
  if (storedAddress) {
    activeAddress.value = storedAddress;
    return { address: storedAddress };
  }
  return null;
}

export async function signWithWallet(
  xdr: string,
  opts: { networkPassphrase: string; address: string }
): Promise<string> {
  const kit = await getKit();

  // Close any AppKit modal that might auto-open during WalletConnect signing
  // (prevents redirect loop from freighterwallet:// deep link failures)
  const { activeModule } = await import('@creit-tech/stellar-wallets-kit/state');
  const mod = activeModule.value;
  if (mod && (mod as any).modal) {
    try { (mod as any).modal.close(); } catch {}
  }

  // Freighter (and any extension wallet that gates signing on a per-site
  // allowlist) needs an explicit `requestAccess` before the first sign,
  // otherwise the Confirm button stays greyed out with a "not connected"
  // banner. `restoreWalletSession` deliberately skips this on page load
  // to avoid an unsolicited popup, so we do it lazily right before signing.
  // We ALSO use the returned address as the source of truth: if the
  // active wallet account differs from what the dApp thinks, surface a
  // clear error instead of producing a txBadAuth on submission.
  if (mod && typeof (mod as any).getAddress === 'function') {
    try {
      const { address: activeAddr } = await (mod as any).getAddress({ skipRequestAccess: false });
      console.log('[WalletKit] active wallet address:', activeAddr, '| expected:', opts.address);
      if (activeAddr && activeAddr !== opts.address) {
        throw new Error(
          `Wallet account changed. The app expected ${opts.address.slice(0, 8)}…${opts.address.slice(-4)} ` +
          `but the wallet is now signing with ${activeAddr.slice(0, 8)}…${activeAddr.slice(-4)}. ` +
          `Reconnect the wallet from the navbar to refresh the session.`,
        );
      }
    } catch (err) {
      // Re-throw the address-mismatch error explicitly; swallow the
      // canonical requestAccess refusal (user can retry).
      if (err instanceof Error && err.message.startsWith('Wallet account changed')) throw err;
      console.warn('[WalletKit] requestAccess failed before signing:', err);
    }
  }

  console.log('[WalletKit] Signing transaction... source =', opts.address);
  try {
    const { signedTxXdr, signerAddress } = await kit.signTransaction(xdr, opts);
    console.log('[WalletKit] Transaction signed. signerAddress =', signerAddress);
    if (signerAddress && signerAddress !== opts.address) {
      throw new Error(
        `Wallet signed with a different account than the transaction source. ` +
        `Source: ${opts.address.slice(0, 8)}…, signer: ${signerAddress.slice(0, 8)}…. ` +
        `This would fail on-chain with txBadAuth — reconnect the wallet to align accounts.`,
      );
    }
    return signedTxXdr;
  } catch (err) {
    console.error('[WalletKit] Signing failed:', err);
    // A user declining the wallet prompt should read as one clean line in
    // every flow, not the wallet's raw decline string. Our own account-mismatch
    // guard (thrown just above) doesn't match this pattern, so it still
    // propagates unchanged.
    if (isWalletRejection(err)) throw new Error(WALLET_REJECTION_MESSAGE);
    throw err;
  }
}

export async function disconnectWallet(): Promise<void> {
  try {
    const kit = await getKit();
    await kit.disconnect();
  } catch {
    // Some wallets may not support disconnect — ignore
  }
}
