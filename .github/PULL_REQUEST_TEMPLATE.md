<!--
Thanks for opening a PR! Please fill out this template.
See docs/GIT_WORKFLOW.md for branch / commit / merge policy.
-->

## Summary

<!-- 1-3 sentences: what does this change, and why? -->

## Tranche / Phase

<!-- e.g. Tranche 2 — Phase 3 (API v0). Use N/A for hotfixes. -->

## Type of Change

- [ ] Feature (`feat`)
- [ ] Bug fix (`fix`)
- [ ] Documentation (`docs`)
- [ ] Refactor (`refactor`)
- [ ] Test (`test`)
- [ ] Chore / tooling (`chore`, `ci`, `build`)
- [ ] Performance (`perf`)
- [ ] Breaking change

## Scope

<!-- Which packages / contracts are touched? -->
- [ ] `contracts/*` (Soroban)
- [ ] `indexer/`
- [ ] `api/`
- [ ] `sdk-ts/`
- [ ] `sdk-py/`
- [ ] `packages/types/`
- [ ] `packages/shared/`
- [ ] `web/`
- [ ] `scripts/keeper/`
- [ ] `docs/` / root config

## Changes

<!-- Bullet list of the concrete changes in this PR. -->

-
-
-

## Test Plan

<!-- How did you verify this works? Commands run, scenarios exercised. -->

- [ ] Unit tests pass (`<command>`)
- [ ] Integration tests pass (`<command>`)
- [ ] Manual verification (describe)

## Contract / WASM Checks

<!-- Only if contracts/ was touched. Delete this section otherwise. -->

- [ ] `cargo test` passes
- [ ] `cargo build --release --target wasm32-unknown-unknown` succeeds
- [ ] Market WASM size ≤ 64 KB
- [ ] New contract (if any) added to `contracts.json`

## Breaking Changes

<!-- Describe any breaking changes and the migration path. -->

None.

## Screenshots / Recording

<!-- For UI changes, add screenshots or a short screen recording. -->

## Checklist

- [ ] Branch follows naming: `feature/t2-p<N>-<slug>`, `fix/t2-<slug>`, or `hotfix/<slug>`
- [ ] Commits follow Conventional Commits (enforced by `commit-msg` hook)
- [ ] Self-reviewed the diff
- [ ] Updated relevant docs
- [ ] CI is green
