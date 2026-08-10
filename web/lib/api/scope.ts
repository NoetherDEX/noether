/**
 * Deployment scope this BUILD of the site belongs to. The one shared
 * gateway serves every frontend, so the scope in each proxy request is what
 * keeps venues apart: the testnet site asks for testnet rows, the mainnet
 * site asks for mainnet rows (an empty board until mainnet launches, and
 * never testnet history).
 *
 * Resolution order:
 * 1. NEXT_PUBLIC_LEADERBOARD_SCOPE when set to a known scope.
 * 2. NEXT_PUBLIC_NETWORK_LABEL, where 'mainnet' or 'public' means mainnet.
 * 3. 'testnet'.
 *
 * Both env references stay literal `process.env.X` expressions so Next.js
 * can inline them at build time.
 */
export function leaderboardScope(): 'testnet' | 'mainnet' {
  const explicit = process.env.NEXT_PUBLIC_LEADERBOARD_SCOPE;
  if (explicit === 'mainnet' || explicit === 'testnet') return explicit;
  const label = process.env.NEXT_PUBLIC_NETWORK_LABEL;
  if (label === 'mainnet' || label === 'public') return 'mainnet';
  return 'testnet';
}
