# Noeracle feature requests — driven by the Noether perp integration

> Implementation-ready issues for the **Noeracle** repo (`github.com/noeracle/noeracle`),
> generated while integrating Noeracle into the Noether PerpDEX.
> **Grounded against the real cloned source** (`main`): `oracle_v0/src/lib.rs`,
> `sdk/src/{client,types,stream}.ts`, `examples/consumer_v0/src/lib.rs`.
>
> Soroban hard constraint: **one `InvokeHostFunction` op per transaction** — you cannot prepend an
> oracle-update op to an app op. Atomic "verify price + use price" must happen *inside one contract
> invocation* (the `consumer_v0` shape).

---

## 🔴 S-1 · CRITICAL — the persistent slot Noether reads is writable by anyone

This is the headline finding and a **hard blocker for any mainnet / real-value integration**.

**What the source actually shows.** Only **`update_batch_ed25519_args`** is a hardened production
entrypoint — it checks `is_publisher` (registered key), staleness (`now - ts ≤ 60`), and monotonic
`round_id` (`oracle_v0/src/lib.rs` L116-172). **Every other `update_*` is a benchmark stub** (module
doc, L8-10: *"exist to measure the Soroban host cost… not part of the production path"*) and each is
missing the production checks:

| Entrypoint | Storage | sig checked | registered-publisher check | staleness | monotonic round |
|---|---|---|---|---|---|
| `update_batch_ed25519_args` | temp | ✅ | ✅ | ✅ | ✅ |
| `update_ed25519_args` | temp | ✅ (arg-supplied key) | ❌ | ❌ | ❌ |
| `update_ed25519_stored` | temp | ✅ (stored keys) | ✅ | ❌ | ❌ |
| **`update_ed25519_persistent`** | **persistent** | ✅ (arg-supplied key) | ❌ | ❌ | ❌ |
| `update_bls_agg` / `update_secp256k1` | temp | ✅ (arg-supplied key) | ❌ | ❌ | ❌ |
| `update_via_auth` | temp | `require_auth` (arg-supplied addr) | ❌ | ❌ | ❌ |

The arg-supplied-key entrypoints verify a signature **against a key the caller also supplies** — so an
attacker signs the malicious message with *their own* keypair, passes their own pubkey+sig, and the
`ed25519_verify` trivially passes. No `is_publisher` gate → **anyone can store any price.**

**Why this breaks Noether specifically.** Noether's keeper writes via `update_ed25519_persistent`
(`scripts/keeper/src/stellar.ts`), and the shim reads `get_price_pers` (persistent). That persistent
slot is exactly the unchecked, anyone-writable one. An attacker calls
`update_ed25519_persistent(BTC, 1, now, u64::MAX, [their_key], [their_sig])` → BTC reads as \$1 → free
liquidations / free positions / drained vault.

**Atomicity does not save you.** Even an atomic router that re-writes the price in-tx is defeated:
`update_ed25519_persistent` has no monotonic guard, so an attacker pre-stores a `round_id = u64::MAX`
malicious price; the legit write (if it had a monotonic guard) would refuse to overwrite, and a read
returns the poison. Reading *any* current storage slot is unsafe.

**The only safe shape today** is `examples/consumer_v0/src/lib.rs`: pass the signed price as args to
your contract, call the **hardened** `update_batch_ed25519_args` to verify it, and use the **arg value
you passed** (now known-verified) — never read a storage slot. Noether can't use that directly because
the *market is untouched* and reads price from storage via the adapter→shim.

**Fix (pick one, ideally both).**
1. **Harden the persistent path** — make `update_ed25519_persistent` (or the new
   `update_batch_ed25519_persistent`, P0-1) enforce `is_publisher` + staleness + monotonic, exactly
   like `update_batch_ed25519_args`. This makes storage reads safe → Noether's heartbeat + shim work.
2. **Feature-gate the benchmark entrypoints out of the deployed wasm** (`#[cfg(feature = "bench")]`)
   so `update_ed25519_args/_persistent/_bls_agg/_secp256k1/_via_auth` aren't callable in production.

**Testnet note.** On testnet with valueless tokens this is *demo-acceptable* — it kills `#30` and
nobody can steal anything real. But it must be fixed before mainnet or before anything of value rides
on it. Treat S-1 as the gate between "testnet demo" and "real."

---

## P0-1 · `update_batch_ed25519_persistent` (hardened, batch, → persistent)

**Problem.** The only persistent writer (`update_ed25519_persistent`) is single-asset **and** unchecked
(see S-1). With 1-op-per-tx, a keeper heartbeat for N assets is N transactions/cycle.

**Proposed.** Add a hardened batch persistent entrypoint — clone `update_batch_ed25519_args`
(L116-172: length check → `is_publisher` → staleness → per-asset ed25519_verify → monotonic) but write
**persistent** with `PERS_THRESHOLD/PERS_EXTEND` instead of `write_temp`. (Note: there is **no**
shared `store_batch(persist)` helper in the source — temp writes go through `write_temp`, persistent is
inline in `update_ed25519_persistent`; the new fn writes persistent inline with its own monotonic
check against `PricePers`.)

**Acceptance.** 3-asset batch in one tx, all readable via `get_price_pers`; non-publisher → `Err`;
stale → `Err`; lagging `round_id` → silent no-op; length mismatch → `BatchLengthMismatch`.

**Impact.** Keeper heartbeat → 1 tx/cycle, and (with S-1 checks baked in) it's the *safe* production
persistent path Noether's shim should read.

---

## P0-2 · SDK builders for the persistent path

**Problem.** `Fresh.toUpdateOp()/updateArgs()` (`sdk/src/client.ts` L54-98) build
`update_batch_ed25519_args` (temp) only. Persistent consumers hand-roll ScVals (Noether keeper does).

**Proposed.** `Fresh.toPersistentBatchUpdateOp(contractId)` + `persistentBatchUpdateArgs()` targeting
the P0-1 entrypoint (same arg order). Keep the temp builder for `consumer_v0`-style inline use.

**Acceptance.** SDK-built op writes `PricePers`, readable by `get_price_pers`; testnet integration test.

---

## P0-3 · Browser-safe op building (smaller than first thought)

Corrected against source:
- ✅ **SSE already works in browser AND Node** — `streamSse` (`sdk/src/stream.ts`) uses `fetch` +
  `ReadableStream`, *no* `EventSource` dependency. Pattern-C display and a keeper stream both work today.
- ❌ **Op building is Node-only** — `Fresh.updateArgs()` uses `Buffer.from(hex, "hex")`
  (`sdk/src/client.ts` L64). In a browser this needs a polyfill.

**Proposed.** Replace `Buffer` with a `Uint8Array`/hex decoder in the op builders; add a `"browser"`
condition to the `exports` map in `sdk/package.json` (it has `exports` but no browser field; engines
node ≥18).

**Acceptance.** `subscribe`, `fetchLatest`, and op builders run unmodified in a Next.js client component.

---

## P1-4 · Historical `prices()` + optional `twap()` (perp-grade marks)

`store_single` overwrites the latest entry, so no consumer can TWAP. Perps need manipulation-resistant
marks for funding + liquidation sanity (a single 500ms tick can wick).

**Proposed.** `prices(asset, records) -> Option<Vec<PriceEntry>>` (bounded ring buffer, newest first)
and optional `twap(asset, records) -> Option<i128>`. The genuine "perp-friendly" edge vs Reflector's
5-min cadence.

---

## P1-5 · Optional read-time staleness guard

`get_price_pers` returns whatever is stored regardless of age. Add
`get_price_pers_fresh(asset, max_age) -> Option<PriceEntry>` (None past `max_age`); leave
`get_price_pers` for back-compat. (Noether's `#30` market check already guards it, but other consumers
won't.)

---

## P2-6 · SEP-40 read compliance (delete the shim / ecosystem drop-in)

Noeracle implements no SEP-40, which is the sole reason `noeracle_shim` exists.
- **6a (deletes the shim):** add `lastprice(asset: Symbol) -> Option<(i128,u64)>` reading the
  (hardened, post-S-1) persistent slot via the internal `Symbol→BytesN<8>` map (`assetToTag` rule in
  `sdk/src/client.ts`). Then Noether's adapter points straight at Noeracle. **Depends on S-1.**
- **6b (full standard):** implement `PriceFeedTrait` (`base, assets, decimals, resolution, price,
  prices, lastprice`) with `Asset` enum + `PriceData`. Drop-in for Blend & every SEP-40 consumer.

---

## P2-7 · Multi-publisher / threshold signatures

Single-key publisher = single point of failure. **Already scaffolded:** the Vec<pubkey>/Vec<sig> shape
across the ed25519 entrypoints and `update_bls_agg` (real `pairing_check`) are there. Verify an
**M-of-N** threshold over the registered set; configure via `set_publishers`; reject `< M` valid
distinct-publisher sigs.

---

## P3-8 · Freshness observability

`last_update(asset) -> Option<(u64 ts, u64 round)>` and/or an event per successful update so a keeper
can alarm on a stalled feed.

---

### Dependency map (Noether ⇽ Noeracle)

| Noether phase | Needs |
|---|---|
| **Anything beyond testnet demo** | **S-1** (harden writes) — hard gate |
| Heartbeat — cheap fast push | **P0-1** (hardened batch persistent), **P0-2** (SDK builder) |
| Router — atomic at-trade freshness | **P0-2**, **P0-3** (browser Buffer fix); safe only after **S-1** |
| Funding / liquidation quality | **P1-4** (TWAP / `prices`) |
| Drop the shim | **P2-6a** (SEP-40 `lastprice`) + **S-1** |
| Production trust | **P2-7** (multi-publisher), **P1-5** (read staleness) |

**Router reference:** `examples/consumer_v0/src/lib.rs::open_position` is the canonical inline shape —
but it uses the *verified arg price directly*, not a storage read. Noether's market-untouched design
reads from storage, so Noether needs S-1 (safe storage) rather than the bare consumer_v0 pattern.

### Noether-side fix (not a Noeracle issue — done in the Noether repo when you greenlight)

**Fix #0.** `contracts/noeracle_shim/src/lib.rs` L58-66 — change `NoeraclePriceEntry` to the real
3-field shape `{ price: i128, timestamp: u64, round_id: u64 }` (drop `asset` + `sources`), or every
shim read panics on deserialization.
