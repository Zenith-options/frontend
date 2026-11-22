# Self-Hosting Zenith Frontend

This guide covers running the Zenith frontend in a Docker container without
rebuilding the image for different environments.

## Quick start (mock / local dev)

```bash
docker compose up
# → http://localhost:3000
```

No backend required — mock mode is enabled by default.

## Running with the real backend

```bash
docker compose --profile full up
# → frontend: http://localhost:3000
# → backend:  http://localhost:8081
```

## Environment variables

These are the variables validated by `src/env-schema.cjs`. Variables marked
**Required** must be set for a production build (`NODE_ENV=production`).
Unset optional variables fall back to the default shown.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Set by Next.js; do not override in normal use |
| `NEXT_PUBLIC_API_URL` | Yes (production) | `http://localhost:8081` | Zenith backend base URL |
| `NEXT_PUBLIC_STELLAR_NETWORK` | Yes (production) | `testnet` | `testnet` or `mainnet` |
| `NEXT_PUBLIC_STELLAR_TESTNET_CONTRACT_ID` | Yes (production, testnet) | _(empty)_ | Soroban contract ID used when the network is `testnet` |
| `NEXT_PUBLIC_STELLAR_MAINNET_CONTRACT_ID` | Yes (production, mainnet) | _(empty)_ | Soroban contract ID used when the network is `mainnet` |
| `NEXT_PUBLIC_APP_VERSION` | No | `0.1.0` | Version string shown in the app |
| `NEXT_PUBLIC_BUILD_SHA` | No | `local` | Git commit SHA shown in the app |
| `NEXT_PUBLIC_VAULTS` | No | `mock` | Vault data source: `mock` or `live` |
| `NEXT_PUBLIC_CONTRACT_GOVERNOR_TESTNET` | No | _(empty)_ | Governor contract ID on testnet |
| `NEXT_PUBLIC_CONTRACT_GOVERNOR_MAINNET` | No | _(empty)_ | Governor contract ID on mainnet |
| `NEXT_PUBLIC_CONTRACT_MARKET_TESTNET` | No | _(empty)_ | Market contract ID on testnet |
| `NEXT_PUBLIC_CONTRACT_MARKET_MAINNET` | No | _(empty)_ | Market contract ID on mainnet |
| `NEXT_PUBLIC_CONTRACT_VAULT_TESTNET` | No | _(empty)_ | Vault contract ID on testnet |
| `NEXT_PUBLIC_CONTRACT_VAULT_MAINNET` | No | _(empty)_ | Vault contract ID on mainnet |
| `NEXT_PUBLIC_CONTRACT_ORACLE_TESTNET` | No | _(empty)_ | Oracle contract ID on testnet |
| `NEXT_PUBLIC_CONTRACT_ORACLE_MAINNET` | No | _(empty)_ | Oracle contract ID on mainnet |
| `NEXT_PUBLIC_CONTRACT_TIMELOCK_TESTNET` | No | _(empty)_ | Timelock contract ID on testnet |
| `NEXT_PUBLIC_CONTRACT_TIMELOCK_MAINNET` | No | _(empty)_ | Timelock contract ID on mainnet |
| `NEXT_PUBLIC_CONTRACT_DEPLOYER_TESTNET` | No | _(empty)_ | Deployer contract ID on testnet |
| `NEXT_PUBLIC_CONTRACT_DEPLOYER_MAINNET` | No | _(empty)_ | Deployer contract ID on mainnet |

## Building a custom image

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://api.zenith.finance \
  -t my-zenith-frontend:local \
  .
```

Passing `--build-arg` sets fallback values baked into the image. You can
still override them at runtime via `-e` or `docker compose` environment
variables.

## Production checklist

- [ ] Set `NEXT_PUBLIC_API_URL` to your real backend URL
- [ ] Set `NEXT_PUBLIC_STELLAR_NETWORK=mainnet` for mainnet deployment
- [ ] Set `NEXT_PUBLIC_STELLAR_MAINNET_CONTRACT_ID` (or the testnet variant) to the deployed Soroban contract ID
- [ ] Set `NEXT_PUBLIC_VAULTS=live` to use the backend instead of mock vault data
- [ ] Put the container behind a TLS-terminating reverse proxy (nginx, Caddy)
- [ ] Configure your CSP to allow the API and RPC origins

## Image provenance

Release images are built, scanned with Trivy for CVEs, and pushed to
`ghcr.io/zenith-options/frontend` on every git tag by the
`.github/workflows/docker.yml` CI job.  The SARIF scan results are
uploaded to GitHub's Security tab for every push.
