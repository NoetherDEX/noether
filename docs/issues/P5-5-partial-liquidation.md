# P5-5 Partial Liquidation — needs a product/economic decision before build

Status: **designed, blocked on a decision** (not implemented). Full liquidation
(current behaviour) remains correct and fund-safe in the meantime.

## The problem (why it isn't just "close a fraction")

The design surfaced a non-obvious invariant: for an isolated position, equity,
PnL, and funding **all scale linearly with the remaining fraction** (entry price
and the funding anchor are unchanged). So if you close a fraction `f` purely
pro-rata:

```
residual_equity   = (1-f) · E
residual_required = (1-f) · S · mm / BP
```

The `(1-f)` cancels — **the margin RATIO is identical before and after.** A pure
pro-rata partial close cannot make a liquidatable position healthy; the residual is
still liquidatable, so the keeper would just close another chunk next round
(incremental liquidation, not health-restoring).

## The decision

To make partial liquidation actually restore health you must **inject value into
the residual** — i.e. *recapitalise the survivor* by withholding (part of) the
liquidation penalty from the closed slice and adding it to the residual collateral
(dYdX/GMX-style). That is a real economic-model choice with trade-offs:

- **Recapitalise survivor** (partial liq heals the position): better UX, but the
  penalty no longer fully flows to the insurance fund / keeper; needs the insurance
  fund (P5-6) wired first to define where the penalty splits.
- **No recapitalise** (trader keeps the closed slice's leftover): the ratio can't
  improve, so "partial liquidation" degenerates into incremental full liquidation —
  only useful to reduce market impact, not to save the trader.

## Recommendation

1. Land **P5-6 (insurance buffer)** first — it defines the penalty/bad-debt split
   that the recapitalisation model depends on.
2. Then implement P5-5 with the **recapitalise-survivor** model, unit-tested against
   hand-computed cases (the design flags math correctness as the top risk), and a
   **fallback to FULL liquidation** when the position is too deep to restore or the
   residual would be dust.
3. Keeper reward is paid on the **closed notional only**.

Until then, full liquidation is the safe default — no fund-safety gap, only a UX/
capital-efficiency improvement is deferred.
