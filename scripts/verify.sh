#!/usr/bin/env bash
#
# Soroscan Verify — MVP end-to-end driver (TESTNET ONLY).
#
# Rebuilds the sample contract from source and asserts byte-for-byte (SHA-256)
# equality against the on-chain WASM for a given testnet contract ID.
#
# Usage:
#   scripts/verify.sh <CONTRACT_ID> [--docker]
#
#   (no flag)  build locally with the pinned toolchain from .tool-versions
#   --docker   build inside the pinned, network-isolated Docker image
#
# Reproducibility check: run twice; the rebuilt SHA-256 must be identical, and
# (given the same image digest) must equal the on-chain hash.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_ID="${1:-}"
MODE="${2:-local}"
WASM="$ROOT/contracts/target/wasm32v1-none/release/hello_soroban.wasm"
IMAGE="soroscan-verify-builder:rust-1.91.1-cli-26.1.0"

if [[ -z "$CONTRACT_ID" ]]; then
  echo "usage: scripts/verify.sh <CONTRACT_ID> [--docker]" >&2
  exit 1
fi

echo "==> [1/3] Rebuilding sample contract from source ($MODE)"
if [[ "$MODE" == "--docker" ]]; then
  docker run --rm --network=none \
    -v "$ROOT/contracts":/work \
    "$IMAGE"
else
  ( cd "$ROOT/contracts" && stellar contract build --locked )
fi

echo "==> [2/3] Rebuilt WASM SHA-256:"
REBUILT_HASH="$(shasum -a 256 "$WASM" | cut -d' ' -f1)"
echo "    $REBUILT_HASH"

echo "==> [3/3] Verifying against on-chain WASM for $CONTRACT_ID"
node "$ROOT/reader/dist/cli.js" verify \
  --id "$CONTRACT_ID" \
  --wasm "$WASM"
