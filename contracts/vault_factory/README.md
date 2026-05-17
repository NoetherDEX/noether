# vault_factory

Tranche 2 deliverable D3 — user-created trading vaults on Soroban.

Any address can mint a vault, depositors send USDC and receive
proportional shares, and the vault leader trades on behalf of the pool
through the existing `market` contract.

## Status

Phase 10 build-up:

| Sub-phase | Commit | Coverage |
|-----------|--------|----------|
| 10.1 | scaffold | empty contract + version() |
| 10.2 | types + storage | VaultInfo, StorageKey, FactoryError, helpers |
| 10.3 | math | nav, shares, profit-owed (11 tests) |
| 10.4 | initialize + create_vault | + 6 tests |
| 10.5 | deposit + withdraw | + 6 tests |
| 10.6 | claim_leader_fees + pause | + 3 tests |
| 10.7 | 5% invariant | + 7 tests (4 math + 3 integration) |

`leader_*` trading proxy + market integration land in subsequent commits.

## Build

```bash
cd contracts
cargo build -p vault_factory --release --target wasm32-unknown-unknown
ls -la target/wasm32-unknown-unknown/release/vault_factory.wasm
# 17_195 bytes — well under the 64 KB Soroban budget.
```

## Test

```bash
cargo test -p vault_factory
# 33 tests passing across math + contract layers.
```

## Public surface (so far)

| Function | Auth | Description |
|----------|------|-------------|
| `version()` | none | sentinel string |
| `initialize(admin, market, usdc)` | admin | one-shot wiring |
| `create_vault(leader, name)` | leader | mints a fresh vault, returns id |
| `deposit(depositor, vault_id, amount)` | depositor | mints shares, moves USDC in |
| `withdraw(depositor, vault_id, shares)` | depositor | burns shares, pays USDC out |
| `claim_leader_fees(vault_id)` | leader | pulls profit share above HWM |
| `set_paused(vault_id, paused)` | leader | leader-only pause |
| `admin_pause(vault_id, paused)` | admin | emergency override |
| `get_vault(id)` / `get_vault_ids()` / `shares_of(id, addr)` | none | views |
| `get_admin()` / `get_market()` / `get_usdc()` | none | views |

## Invariants

- **5% leader skin** — `leader_shares × BPS_DENOM ≥ circulating × 500`,
  enforced after every deposit and withdraw. Skipped on empty vaults.
- **HWM no-double-dip** — `claim_leader_fees` resets HWM to the
  post-payout NAV; the leader has to grow the vault past it before
  another claim.
- **Owner-bound auth** — every mutating call requires `require_auth`
  by the relevant principal (admin / leader / depositor). The factory
  contract never moves USDC outside the (depositor, leader, factory)
  triangle.

## Deliverable D3 traceability

| Requirement | Where it lives |
|-------------|----------------|
| Vault factory smart contract on testnet | this crate (deploy script lands in 10.x) |
| Leader trades from vault funds via trade UI | `leader_*` proxies (next commit), + web/UI in 10.x |
| Leaders maintain ≥5% balance | `math::leader_min_holding_ok` + checks in `lib.rs` |
| Vault marketplace listing | `get_vault_ids` + `get_vault` views consumed by `api/` and `web/` |
| Per-vault page (PnL history, open positions, trades) | indexer projects vault events; api/sdk surfaces them |
