# Config-Parity Inventory (P6-3) — demo → mainnet

Every hardcoded/demo constant that MUST be reviewed or swapped before a mainnet
cutover. Grouped by required action. Verify each line is correct for mainnet during
the launch checklist (P6-6 guarded config).

## MUST change / gate (blocks mainnet correctness or safety)

| Item | Location | Demo value | Mainnet action |
|---|---|---|---|
| Network block | `web/lib/utils/constants.ts:94` (`NETWORK`) | `testnet`, Test SDF passphrase, testnet RPC/Horizon | Switch to PUBLIC passphrase + mainnet RPC/Horizon — **prefer reading from `NEXT_PUBLIC_*` env, not a hardcoded const** (P3-4) |
| **Faucet** | `web/lib/stellar/faucet.ts`, `web/lib/hooks/useFaucet.ts`, `web/app/api/faucet/*`, `web/app/faucet/page.tsx`, `scripts/keeper/src/deploy-test-token.ts` | mints test USDC/NOE | **Disable on mainnet** — the faucet must fail-closed when the network is mainnet (you cannot faucet real assets). Currently the claim route is NOT network-gated. |
| Noeracle contract default | `scripts/keeper/src/config.ts:124` | `CAYIP67U…` testnet id | Set `NEXT_PUBLIC_NOERACLE_ID` to the mainnet Noeracle; the hardcoded fallback is testnet-only |
| Contract addresses | `contracts.json`, all `NEXT_PUBLIC_*` | testnet ids | Rewrite to the mainnet deployment after redeploy |

## MUST verify (values that should match the on-chain guarded config)

| Item | Location | Value | Verify against |
|---|---|---|---|
| Max leverage (UI) | `web/lib/utils/constants.ts:104` | `MAX_LEVERAGE: 10` | Must equal the on-chain per-asset `RiskConfig.max_leverage` (P5-1). Guarded launch = 10x ✅ |
| Min collateral | `web/lib/utils/constants.ts:103` | `MIN_COLLATERAL: 10` | Must equal `MarketConfig.min_collateral` |
| Fees | `web/lib/utils/constants.ts:107-112` | maker 20 / taker 50 deci-bps, liq 500 bps | Must equal `MarketConfig` base_maker/taker + liquidation_fee_bps |
| Keeper asset list | `scripts/keeper/src/config.ts:55` (`DEFAULT_ASSETS`) | BTC/ETH/XLM | Must equal the launch pair set (P6-6: 3 pairs) and each must have a `RiskConfig` set on-chain |

## MUST set on-chain at launch (not a code constant — an admin action)

- **Per-asset `RiskConfig`** for every launch pair (P5-1): OI caps, leverage,
  maintenance margin, max position size. Assets with no override are UNCAPPED.
- **Deposit caps** (guarded launch) — enforce via the vault / a deposit allowlist
  (P6-6); not yet a contract constant, track as a launch action.
- **Publisher allowlist** (`set_publishers`) with the real mainnet Noeracle key(s).

## Test-only (no mainnet impact, but don't ship to prod images)

- `scripts/keeper/src/{test-trade.ts,seed-oracle.ts,deploy-test-token.ts}` — test
  scripts with hardcoded testnet ids. Exclude from production builds/deploys.

## Recommended follow-up (P3-4)

Move the `web/lib/utils/constants.ts` `NETWORK` block + any address constants behind
`NEXT_PUBLIC_*` env reads so a network switch needs no code change — this removes the
single largest config-parity risk (shipping a testnet build to mainnet).
