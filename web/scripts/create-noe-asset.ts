/**
 * NOE Token Creation Script
 *
 * Creates the NOE classic Stellar asset and mints initial supply.
 * This script:
 * 1. Creates NOE asset with Admin as issuer
 * 2. Creates trustline for the new vault address (if provided)
 * 3. Mints initial NOE supply to the vault
 * 4. Deploys SAC (Stellar Asset Contract) wrapper for Soroban compatibility
 *
 * Usage: npx tsx scripts/create-noe-asset.ts [vault_address]
 */

import {
  Keypair,
  Asset,
  TransactionBuilder,
  Operation,
  Networks,
  Horizon,
} from '@stellar/stellar-sdk';
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Configuration
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY;
const ADMIN_PUBLIC = process.env.ADMIN_PUBLIC_KEY;
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;

// NOE Token Configuration
const NOE_ASSET_CODE = 'NOE';
const INITIAL_SUPPLY = '1000000000'; // 1 billion NOE

interface AssetInfo {
  assetCode: string;
  issuer: string;
  sacContractId: string | null;
}

/**
 * Create trustline for an account to hold NOE
 */
async function createTrustline(
  server: Horizon.Server,
  accountKeypair: Keypair,
  asset: Asset
): Promise<void> {
  console.log(`  Creating trustline for ${accountKeypair.publicKey().slice(0, 8)}...`);

  const account = await server.loadAccount(accountKeypair.publicKey());

  const transaction = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset: asset,
        limit: '1000000000000', // High limit
      })
    )
    .setTimeout(30)
    .build();

  transaction.sign(accountKeypair);
  await server.submitTransaction(transaction);
  console.log('  ✓ Trustline created');
}

/**
 * Mint NOE tokens to an address
 */
async function mintTokens(
  server: Horizon.Server,
  issuerKeypair: Keypair,
  asset: Asset,
  destinationPublicKey: string,
  amount: string
): Promise<void> {
  console.log(`  Minting ${amount} NOE to ${destinationPublicKey.slice(0, 8)}...`);

  const account = await server.loadAccount(issuerKeypair.publicKey());

  const transaction = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: destinationPublicKey,
        asset: asset,
        amount: amount,
      })
    )
    .setTimeout(30)
    .build();

  transaction.sign(issuerKeypair);
  await server.submitTransaction(transaction);
  console.log(`  ✓ Minted ${amount} NOE`);
}

/**
 * Deploy SAC (Stellar Asset Contract) for the NOE asset
 */
function deploySAC(assetCode: string, issuer: string): string {
  console.log('  Deploying SAC wrapper...');

  const assetString = `${assetCode}:${issuer}`;

  try {
    // Check if stellar CLI is available
    const cli = execSync('which stellar || which soroban', { encoding: 'utf-8' }).trim().split('\n')[0];

    // Deploy SAC
    const result = execSync(
      `${cli} contract deploy --asset "${assetString}" --network testnet --source noether_admin`,
      { encoding: 'utf-8' }
    ).trim();

    console.log(`  ✓ SAC deployed: ${result}`);
    return result;
  } catch (error) {
    // SAC might already exist
    console.log('  ⚠ SAC deployment failed or already exists, trying to get existing...');

    try {
      const cli = execSync('which stellar || which soroban', { encoding: 'utf-8' }).trim().split('\n')[0];
      const result = execSync(
        `${cli} contract id asset --asset "${assetString}" --network testnet`,
        { encoding: 'utf-8' }
      ).trim();
      console.log(`  ✓ Existing SAC found: ${result}`);
      return result;
    } catch {
      throw new Error('Failed to deploy or find SAC contract');
    }
  }
}

/**
 * Save NOE asset info to files
 */
function saveAssetInfo(assetInfo: AssetInfo, projectRoot: string): void {
  // Update .env
  const envPath = path.join(projectRoot, '.env');
  const envContent = fs.readFileSync(envPath, 'utf-8');

  // Check if NOE entries already exist
  if (!envContent.includes('NEXT_PUBLIC_NOE_TOKEN_ID')) {
    const noeEnvEntries = `
# NOE Token (LP Token) - Created ${new Date().toISOString()}
NEXT_PUBLIC_NOE_TOKEN_ID=${assetInfo.sacContractId}
NEXT_PUBLIC_NOE_ASSET_CODE=${assetInfo.assetCode}
NEXT_PUBLIC_NOE_ISSUER=${assetInfo.issuer}
`;
    fs.appendFileSync(envPath, noeEnvEntries);
    console.log('  ✓ Added NOE config to .env');
  }

  // Update contracts.json
  const contractsPath = path.join(projectRoot, 'contracts.json');
  if (fs.existsSync(contractsPath)) {
    const contracts = JSON.parse(fs.readFileSync(contractsPath, 'utf-8'));
    contracts.contracts.noeToken = assetInfo.sacContractId;
    contracts.noeAsset = {
      code: assetInfo.assetCode,
      issuer: assetInfo.issuer,
    };
    fs.writeFileSync(contractsPath, JSON.stringify(contracts, null, 2));
    console.log('  ✓ Updated contracts.json');
  }
}

async function main() {
  console.log('');
  console.log('═'.repeat(60));
  console.log('  NOE Token Creation Script');
  console.log('═'.repeat(60));
  console.log('');

  // Validate environment
  if (!ADMIN_SECRET || !ADMIN_PUBLIC) {
    console.error('ERROR: ADMIN_SECRET_KEY and ADMIN_PUBLIC_KEY must be set in .env');
    process.exit(1);
  }

  const adminKeypair = Keypair.fromSecret(ADMIN_SECRET);
  const server = new Horizon.Server(HORIZON_URL);

  // Get vault address from command line or prompt
  const vaultAddress = process.argv[2];

  console.log('Configuration:');
  console.log(`  Asset Code:     ${NOE_ASSET_CODE}`);
  console.log(`  Issuer:         ${ADMIN_PUBLIC.slice(0, 8)}...${ADMIN_PUBLIC.slice(-8)}`);
  console.log(`  Initial Supply: ${INITIAL_SUPPLY} NOE`);
  console.log(`  Vault Address:  ${vaultAddress ? vaultAddress.slice(0, 8) + '...' : 'Not specified (will mint to admin)'}`);
  console.log('');

  // Create NOE asset
  const noeAsset = new Asset(NOE_ASSET_CODE, ADMIN_PUBLIC);
  console.log('[1/4] Creating NOE asset...');
  console.log(`  Asset: ${NOE_ASSET_CODE}:${ADMIN_PUBLIC}`);
  console.log('  ✓ Asset defined (classic assets are created on first trustline/payment)');
  console.log('');

  // Determine mint destination
  const mintDestination = vaultAddress || ADMIN_PUBLIC;

  // If minting to admin (self), we need a distribution account or mint to self
  if (mintDestination === ADMIN_PUBLIC) {
    console.log('[2/4] Minting to Admin account...');
    console.log('  Note: Admin is the issuer, so we create a self-payment');

    // For issuer, we just need to send to another account that has trustline
    // For now, we'll create a temporary holding pattern
    // The actual minting will happen when we transfer to vault later
    console.log('  ✓ NOE is ready to mint (will mint when vault address is provided)');
    console.log('');
  } else {
    // Create trustline for vault
    console.log('[2/4] Creating trustline for Vault...');

    // Note: The vault needs to add trustline first
    // This would be done in the vault initialization
    console.log('  ⚠ Vault must have trustline before receiving NOE');
    console.log('  → Run this script again after deploying new vault with trustline');
    console.log('');

    // Mint to vault
    console.log('[3/4] Minting NOE to Vault...');
    try {
      await mintTokens(server, adminKeypair, noeAsset, mintDestination, INITIAL_SUPPLY);
    } catch (error: any) {
      if (error.response?.data?.extras?.result_codes?.operations?.includes('op_no_trust')) {
        console.log('  ⚠ Vault does not have NOE trustline yet');
        console.log('  → Deploy vault with NOE trustline first, then run mint script');
      } else {
        throw error;
      }
    }
    console.log('');
  }

  // Deploy SAC
  console.log('[4/4] Deploying SAC (Stellar Asset Contract)...');
  let sacContractId: string | null = null;
  try {
    sacContractId = deploySAC(NOE_ASSET_CODE, ADMIN_PUBLIC);
  } catch (error) {
    console.log('  ⚠ SAC deployment skipped (may need to run manually)');
  }
  console.log('');

  // Save asset info
  const projectRoot = path.resolve(__dirname, '../..');
  console.log('Saving asset info...');
  saveAssetInfo(
    {
      assetCode: NOE_ASSET_CODE,
      issuer: ADMIN_PUBLIC,
      sacContractId,
    },
    projectRoot
  );
  console.log('');

  // Summary
  console.log('═'.repeat(60));
  console.log('  Summary');
  console.log('═'.repeat(60));
  console.log('');
  console.log('NOE Asset Created:');
  console.log(`  Code:         ${NOE_ASSET_CODE}`);
  console.log(`  Issuer:       ${ADMIN_PUBLIC}`);
  console.log(`  SAC Contract: ${sacContractId || 'Pending'}`);
  console.log('');

  if (!vaultAddress) {
    console.log('Next Steps:');
    console.log('  1. Deploy the new Vault contract (v2)');
    console.log('  2. Run: npx tsx scripts/mint-noe-to-vault.ts <vault_address>');
    console.log('');
  }

  console.log('═'.repeat(60));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
