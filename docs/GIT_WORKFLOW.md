# Git Workflow

This document defines how we work with branches, commits, and pull requests on the Noether monorepo during Tranche 2 and beyond.

---

## TL;DR

- `main` is the stable, testnet-deployed release — never commit directly.
- `develop` is the Tranche 2 integration branch — never commit directly.
- All work happens on `feature/*`, `fix/*`, or `hotfix/*` branches and lands via pull request.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).
- Pull requests are squash-merged; one clean commit per PR.

---

## Branch Model

We use a **modified Git Flow** tuned for a multi-phase deliverable schedule.

```
main         ◄──── squash-merge ◄──── develop      (only at tranche completion)
                                        ▲
                                        │ squash-merge
                                        │
                              feature/t2-pN-<slug>
                              fix/t2-<slug>
```

### `main`

- Represents the current testnet-deployed, audited release.
- Always deployable.
- Protected: no direct commits, no force pushes.
- Receives merges **only** from:
  - `develop` at the end of a tranche
  - `hotfix/*` branches for emergency patches to production

### `develop`

- The integration branch for the current tranche.
- All `feature/*` and `fix/*` branches merge here first.
- Can be deployed to a staging / preview environment.
- Protected: no direct commits, no force pushes.

### Feature Branches

Short-lived branches for a specific unit of work.

**Naming convention:**

```
feature/t2-p<phase>-<slug>
```

Examples:

```
feature/t2-p0-devenv
feature/t2-p1-foundation
feature/t2-p2-indexer-v0
feature/t2-p3-api-v0
feature/t2-p10-vault-factory
```

Sub-work within a phase, when a phase is large enough to warrant multiple PRs:

```
feature/t2-p2-indexer-router
feature/t2-p2-indexer-handlers
feature/t2-p2-indexer-candles
```

### Fix Branches

For bugs discovered inside the current tranche but outside a specific phase.

```
fix/t2-<slug>
```

Example: `fix/t2-hmac-timestamp-skew`

### Hotfix Branches

For emergency production fixes that cannot wait for the next tranche merge. Branch off `main`, land on `main`, cherry-pick into `develop`.

```
hotfix/<slug>
```

Example: `hotfix/keeper-rate-limit-retry`

### Archive Branches

Historical branches from past tranches that we keep for traceability but no longer maintain.

```
archive/t1-develop
archive/t1-feature-<name>
```

---

## Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/). Format:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Types

| Type       | Use for                                                      |
|------------|--------------------------------------------------------------|
| `feat`     | A new user-facing feature                                    |
| `fix`      | A bug fix                                                    |
| `docs`     | Documentation only                                           |
| `chore`    | Build process, tooling, dependency bumps (no production code)|
| `refactor` | Code change that neither fixes a bug nor adds a feature      |
| `test`     | Adding or updating tests                                     |
| `perf`     | Performance improvement                                      |
| `ci`       | CI configuration                                             |
| `build`    | Build system, packaging, bundler config                      |
| `revert`   | Reverts a previous commit                                    |

### Scope

Use the package or module being touched:

- `contracts`, `market`, `vault`, `oracle`, `referral`, `vault_factory`
- `indexer`, `api`, `ws`
- `sdk-ts`, `sdk-py`
- `web`, `keeper`
- `docs`, `ci`, `deps`, `types`, `shared`

### Examples

```
feat(indexer): add event router with pluggable decoders
fix(api): validate HMAC timestamp within 30s window
docs(workflow): document hotfix process
chore(deps): upgrade fastify to 5.1.0
test(vault_factory): add 5% invariant fuzz cases
refactor(shared): extract precision helpers to dedicated module
perf(ws): coalesce orderbook updates within 50ms window
ci(gh): add wasm size budget check
build(tsup): enable dual ESM/CJS output for sdk-ts
```

### Rules enforced by `commitlint`

- `type` must be one of the list above.
- `header` (first line) must be <= 100 characters.
- Body and footer are optional but, when present, must be separated by a blank line.

---

## Pull Request Workflow

### 1. Start work

```bash
git checkout develop
git pull --ff-only origin develop
git checkout -b feature/t2-p<N>-<slug>
```

### 2. Do the work

- Make focused commits. Each commit should be independently reviewable.
- Run local checks before committing — the pre-commit hook will also remind you.
- Rebase on `develop` periodically if the branch is long-lived:
  ```bash
  git fetch origin
  git rebase origin/develop
  ```

### 3. Open the PR

- Target branch: `develop` (for tranche work) or `main` (for hotfixes / devenv).
- Fill out the PR template (`.github/PULL_REQUEST_TEMPLATE.md`).
- Self-review the diff before requesting review.
- Ensure CI is green.

### 4. Review and merge

- At least one approval required before merge (recommended).
- **Merge strategy: squash and merge.** This keeps `develop` and `main` histories clean — one commit per PR.
- Squash commit message should follow Conventional Commits.
- Delete the feature branch after merge.

### 5. Post-merge

- Pull the updated `develop` locally.
- Start the next branch fresh from `develop`.

---

## Release Flow

### End of tranche

1. Ensure `develop` is stable and all phases merged.
2. Open PR `develop` → `main` with title `release: Tranche 2`.
3. Review full diff, run full test matrix.
4. Squash merge.
5. Tag the merge commit: `git tag -a t2-release -m "Tranche 2 release"`.
6. Push the tag.

### Hotfix flow

1. Branch from `main`: `git checkout -b hotfix/<slug> main`
2. Fix and commit.
3. Open PR to `main`, review, merge.
4. Cherry-pick or merge into `develop` so the fix is not lost when tranche merges:
   ```bash
   git checkout develop
   git cherry-pick <sha>
   ```

---

## Protected Branches

The following protections are enforced **locally** via git hooks and **should also** be enforced on GitHub via branch protection rules:

### Local (via `.husky/pre-commit`)

- Direct commits to `main` and `develop` are blocked.
- Override (only for automated tooling or emergencies):
  ```bash
  ALLOW_PROTECTED_COMMIT=1 git commit ...
  ```

### Recommended GitHub settings

For `main` and `develop`:

- Require a pull request before merging
- Require status checks to pass (CI must be green)
- Require conversation resolution before merging
- Disallow force pushes
- Disallow deletions
- For `main`: require signed commits (optional, nice-to-have)

---

## Working Environment Guarantees

- Testnet contracts deployed during Tranche 1 (`market`, `vault`, `mock_oracle`, `oracle_adapter`, `usdc`, `noe`) remain untouched during Tranche 2 development. They are pinned in `contracts.json`.
- New contracts introduced during Tranche 2 (`vault_factory`, `referral`) are deployed to new addresses and added to `contracts.json` in the phase where they land.
- `market` redeploy during Tranche 2 is planned for Phase 11 (referral integration) and must follow a documented migration procedure.
- `web/` and `scripts/keeper/` retain their existing `package.json` setups until a dedicated migration phase. New packages live under `api/`, `indexer/`, `sdk-ts/`, `sdk-py/`, `packages/*`.

---

## Quick Reference

```bash
# Start a new phase branch
git checkout develop && git pull --ff-only && git checkout -b feature/t2-p5-api-trading

# Good commits
git commit -m "feat(api): add /v1/orders/prepare endpoint"
git commit -m "fix(indexer): handle ledger gaps in event polling"
git commit -m "test(referral): cover claim after volume threshold"

# Bad commits (hook will reject)
git commit -m "stuff"                    # no type
git commit -m "FIX: typo"                # wrong case, no scope
git commit -m "fix: this thing I broke"  # too vague

# When you mess up a commit message
git commit --amend -m "feat(scope): correct message"

# When you finish a PR
# (merge via GitHub; then:)
git checkout develop
git pull --ff-only
git branch -d feature/t2-p5-api-trading
```
