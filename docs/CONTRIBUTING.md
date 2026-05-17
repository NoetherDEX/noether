# Contributing to Noether

This guide covers how to get the repository set up locally and the day-to-day workflow.

For branch strategy, commit conventions, and PR process see [`GIT_WORKFLOW.md`](./GIT_WORKFLOW.md).

---

## Prerequisites

- **Node.js 20+** (managed via `nvm` recommended)
- **Rust 1.79** (for Soroban contracts, matching the pinned toolchain)
- **Git 2.30+**
- A Stellar testnet account with funded admin keypair (see `.env.example`)

---

## First-Time Setup

### 1. Clone and install root dependencies

```bash
git clone https://github.com/NoetherDEX/noether.git
cd noether
npm install
```

Installing the root `package.json` sets up git hooks automatically via `husky`. After `npm install` you should see:

```
> husky
```

in the output.

### 2. Verify hooks are active

```bash
ls .husky/
# should list: pre-commit, commit-msg, _/
```

Try an invalid commit message to confirm the hook is wired:

```bash
git commit --allow-empty -m "bad message"
# expected: commit rejected by commit-msg hook
```

### 3. Configure environment

Copy the example env file and fill in secrets:

```bash
cp .env.example .env
# edit .env with your testnet keys
```

Do **not** commit `.env`. Only `.env.example` is tracked.

### 4. Set up workspace packages (Phase 1+)

> Phase 1 and later packages (`api/`, `indexer/`, `sdk-ts/`, `packages/*`) live under npm workspaces. When those land, this section will list install and build instructions.

### 5. Existing services

`web/` and `scripts/keeper/` each have their own `package.json` and should be installed independently:

```bash
cd web && npm install
cd ../scripts/keeper && npm install
```

---

## Daily Workflow

### Starting new work

```bash
# Always start from an up-to-date develop
git checkout develop
git pull --ff-only origin develop

# Create a feature branch (see GIT_WORKFLOW.md for naming)
git checkout -b feature/t2-p<phase>-<slug>
```

### Committing

The `commit-msg` hook enforces [Conventional Commits](https://www.conventionalcommits.org/). Format:

```
<type>(<scope>): <subject>
```

See [`GIT_WORKFLOW.md`](./GIT_WORKFLOW.md#commit-message-format) for the full list of types and scopes.

### Opening a PR

- Target `develop` for Tranche 2 work, `main` for hotfixes.
- Fill out `.github/PULL_REQUEST_TEMPLATE.md`.
- Ensure CI is green before requesting review.
- Squash merge on approval.

---

## Pre-Commit Hook Behavior

The hook at `.husky/pre-commit` runs on every `git commit`. It:

1. **Blocks direct commits** to `main` and `develop`.
2. Prints a helpful message explaining how to create a feature branch.

Override (only for automated tooling or legitimate emergencies):

```bash
ALLOW_PROTECTED_COMMIT=1 git commit -m "..."
```

## Commit-Msg Hook Behavior

The hook at `.husky/commit-msg` runs `commitlint` against the commit message and rejects commits that don't follow Conventional Commits.

---

## Troubleshooting

### Hook not running

```bash
# Re-install hooks
npm run prepare
```

### "husky command not found"

Make sure you ran `npm install` at the repo root, not just in a subdirectory.

### Accidentally committed to `main` or `develop`

The hook should block this. If you overrode it and need to undo:

```bash
# Move the bad commit to a feature branch
git reset HEAD~1 --soft
git stash
git checkout -b feature/t2-<phase>-<slug>
git stash pop
git commit -m "feat(<scope>): <correct message>"
```

### Commit message rejected

Read the `commitlint` output — it tells you exactly which rule failed. Common issues:

- Missing `type:` prefix
- `type` not in the allowed list
- Header longer than 100 characters

Fix by amending:

```bash
git commit --amend -m "feat(scope): proper message"
```

---

## Questions

- Branch/commit/PR policy: [`GIT_WORKFLOW.md`](./GIT_WORKFLOW.md)
- Overall architecture: `README.md`
- Per-package details: `README.md` inside each package directory
