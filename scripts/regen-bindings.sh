#!/usr/bin/env bash
# scripts/regen-bindings.sh
#
# Regenerates TypeScript bindings for Zenith's Soroban contracts.
# Requires: stellar CLI (https://github.com/stellar/stellar-cli)
#
# Usage:
#   NETWORK=testnet bash scripts/regen-bindings.sh
#
# Reads contract IDs from env vars:
#   NEXT_PUBLIC_CONTRACT_MARKET_<NETWORK>
#   NEXT_PUBLIC_CONTRACT_VAULT_<NETWORK>
#   NEXT_PUBLIC_CONTRACT_ORACLE_<NETWORK>

set -euo pipefail

usage() {
  cat >&2 <<EOF
Usage: NETWORK=<network> bash scripts/regen-bindings.sh [--help]

Regenerates TypeScript bindings for Zenith's Soroban contracts using the
stellar CLI.

Environment variables:
  NETWORK  (required) Target Stellar network. Must be "testnet" or "mainnet".
           Defaults to "testnet" when not set.

The script also reads the following env vars for contract IDs (replace
<NETWORK> with the uppercased value of NETWORK):
  NEXT_PUBLIC_CONTRACT_MARKET_<NETWORK>
  NEXT_PUBLIC_CONTRACT_VAULT_<NETWORK>
  NEXT_PUBLIC_CONTRACT_ORACLE_<NETWORK>

Contracts whose env var is unset are skipped — they are not an error.

Prerequisites:
  stellar CLI — https://github.com/stellar/stellar-cli

Examples:
  NETWORK=testnet bash scripts/regen-bindings.sh
  NETWORK=mainnet \\
    NEXT_PUBLIC_CONTRACT_VAULT_MAINNET=C... \\
    bash scripts/regen-bindings.sh
EOF
}

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument '$arg'" >&2
      usage
      exit 1
      ;;
  esac
done

NETWORK="${NETWORK:-testnet}"
OUT_DIR="src/lib/soroban/contracts"

declare -A CONTRACTS=(
  ["market"]="NEXT_PUBLIC_CONTRACT_MARKET_${NETWORK^^}"
  ["vault"]="NEXT_PUBLIC_CONTRACT_VAULT_${NETWORK^^}"
  ["oracle"]="NEXT_PUBLIC_CONTRACT_ORACLE_${NETWORK^^}"
)

echo "[regen-bindings] Network: $NETWORK"

for name in "${!CONTRACTS[@]}"; do
  env_var="${CONTRACTS[$name]}"
  contract_id="${!env_var:-}"

  if [[ -z "$contract_id" ]]; then
    echo "  [skip] $name: $env_var not set"
    continue
  fi

  echo "  [gen] $name ($contract_id) → $OUT_DIR/${name}.ts"

  stellar contract bindings typescript \
    --network "$NETWORK" \
    --contract-id "$contract_id" \
    --output-dir "$OUT_DIR/${name}-generated" \
    --overwrite

  # The generated package exports a Client class; re-export it from our index.
  # In practice you'd copy/merge the generated output into the contracts folder.
  echo "  [ok] $name bindings generated in $OUT_DIR/${name}-generated"
done

echo "[regen-bindings] Done. Review generated files and update $OUT_DIR/index.ts."
