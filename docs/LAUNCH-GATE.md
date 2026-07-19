# Launch Gate — pre-mainnet soft launch

While mainnet contracts are under audit, `noether.exchange` shows only the
`/audit` teaser to the public. People with an access code (SCF verifiers, the
team) unlock the full app. The public keeps trading on
`testnet.noether.exchange` (the frozen `testnet` branch against the current
testnet contracts).

The gate controls the FRONTEND only — mainnet contracts are permissionless
on-chain. It is launch control, not security.

## How it works

- `middleware.ts`: when `LAUNCH_GATE=1` (runtime env), every route rewrites to
  `/audit` unless a valid `noether_access` cookie is present. `/access`,
  `/api/access`, and static assets stay open; gated `/api/*` returns 401 JSON.
- `POST /api/access`: validates a code against `ACCESS_CODES` (comma-separated
  **sha256 hex digests**, runtime env) and sets a 30-day HMAC-signed httpOnly
  cookie (`ACCESS_COOKIE_SECRET`).
- Unlock paths: magic link `https://noether.exchange/access?code=XXX`
  (auto-submits), or the easter egg — five quick taps on the teaser wordmark.
- All envs are RUNTIME (not `NEXT_PUBLIC_*`): enabling/disabling the gate and
  rotating codes is an env update + revision restart — **no rebuild**.

## Generate codes

```bash
CODE="SCF-$(openssl rand -hex 6)"                       # give this to the person
HASH=$(printf '%s' "$CODE" | shasum -a 256 | cut -d' ' -f1)  # goes in ACCESS_CODES
echo "code=$CODE  hash=$HASH"
```

## Enable the gate (deploy day, prod app)

```bash
az containerapp update -n noether-web -g noether-rg --set-env-vars \
  LAUNCH_GATE=1 \
  ACCESS_CODES="<hash1>,<hash2>" \
  ACCESS_COOKIE_SECRET="$(openssl rand -hex 32)"
```

Then send each verifier their link: `https://noether.exchange/access?code=<CODE>`.

- **Revoke one person:** remove their hash from `ACCESS_CODES` and rotate
  `ACCESS_COOKIE_SECRET` (invalidates ALL issued cookies; others re-click
  their links).
- **Public launch:** `az containerapp update -n noether-web -g noether-rg --set-env-vars LAUNCH_GATE=0`
  — seconds, no rebuild.

## Testnet site (deploy day)

```bash
# Build from the testnet branch checkout (values: web/.env.azure.testnet.local,
# same addresses as today's prod + NEXT_PUBLIC_NETWORK_LABEL=testnet ribbon):
./scripts/deploy_web_azure.sh testnet v1
# First run prints the create hint; create mirrors noether-web-staging
# (ingress 3000, ADMIN_SECRET_KEY secret, RPC env), then:
#   - Cloudflare (via MCP): TXT asuid.testnet + grey CNAME testnet → app FQDN
#   - az containerapp hostname add/bind + managed cert
```

The old `testnet.noether.exchange` subdomain is dead/unclaimed — free to use.
