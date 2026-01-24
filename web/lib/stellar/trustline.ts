import { Asset, TransactionBuilder, Operation, Networks, Horizon } from '@stellar/stellar-sdk';
import { NETWORK, NOE_ASSET } from '@/lib/utils/constants';

const server = new Horizon.Server(NETWORK.HORIZON_URL);

/**
 * Check if an account has a trustline for the NOE asset
 */
export async function hasNoeTrustline(publicKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${NETWORK.HORIZON_URL}/accounts/${publicKey}`);

    if (!response.ok) {
      if (response.status === 404) {
        // Account doesn't exist yet
        return false;
      }
      throw new Error(`Horizon API error: ${response.status}`);
    }

    const data = await response.json();
    const balances = data.balances || [];

    // Look for NOE asset in balances
    const hasTrustline = balances.some(
      (balance: { asset_code?: string; asset_issuer?: string }) =>
        balance.asset_code === NOE_ASSET.CODE &&
        balance.asset_issuer === NOE_ASSET.ISSUER
    );

    return hasTrustline;
  } catch (error) {
    console.error('Failed to check NOE trustline:', error);
    return false;
  }
}

/**
 * Create a transaction to add the NOE trustline
 * Returns the XDR that needs to be signed by Freighter
 */
export async function createAddTrustlineTransaction(publicKey: string): Promise<string> {
  try {
    // Load the account
    const account = await server.loadAccount(publicKey);

    // Create the NOE asset
    const noeAsset = new Asset(NOE_ASSET.CODE, NOE_ASSET.ISSUER);

    // Build the transaction with changeTrust operation
    const transaction = new TransactionBuilder(account, {
      fee: '100000', // 0.01 XLM fee (high to ensure processing)
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(
        Operation.changeTrust({
          asset: noeAsset,
          // No limit means unlimited trust
        })
      )
      .setTimeout(300) // 5 minutes
      .build();

    // Return the XDR for signing
    return transaction.toXDR();
  } catch (error) {
    console.error('Failed to create trustline transaction:', error);
    throw error;
  }
}

/**
 * Submit a signed trustline transaction
 */
export async function submitTrustlineTransaction(signedXdr: string): Promise<void> {
  try {
    const transaction = TransactionBuilder.fromXDR(signedXdr, NETWORK.PASSPHRASE);
    const result = await server.submitTransaction(transaction);
    console.log('Trustline added successfully:', result.hash);
  } catch (error) {
    console.error('Failed to submit trustline transaction:', error);
    throw error;
  }
}
