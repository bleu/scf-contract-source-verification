#!/usr/bin/env bash
#
# Soroscan Verify — MVP end-to-end driver (TESTNET ONLY).
#
# Rebuilds the sample contract from source and asserts byte-for-byte (SHA-256)
# equality against the on-chain WASM for a given testnet contract ID.
#
# Usage:
#   scripts/verify.sh <CONTRACT_ID> [--docker]
#   scripts/verify.sh <CONTRACT_ID> --tarball <path> --tarball-sha256 <digest> [--docker]
#
#   (no flag)         build the checked-out contracts/ with the pinned
#                     toolchain from .tool-versions
#   --docker          build inside the pinned, network-isolated Docker image
#   --tarball         content-addressed source submission (SEP-58
#                     tarball_sha256 model): the CLI gates on the digest,
#                     unpacks to a fresh temp dir, rebuilds, and compares —
#                     a tarball that does not match its digest is never built
#
# Reproducibility check: run twice; the rebuilt SHA-256 must be identical, and
# (given the same image digest) must equal the on-chain hash.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASM="$ROOT/contracts/target/wasm32v1-none/release/hello_soroban.wasm"
IMAGE="soroscan-verify-builder:rust-1.91.1-cli-26.1.0"

usage() {
  echo "usage: scripts/verify.sh <CONTRACT_ID> [--docker]" >&2
  echo "       scripts/verify.sh <CONTRACT_ID> --tarball <path> --tarball-sha256 <digest> [--docker]" >&2
  exit 1
}

CONTRACT_ID="${1:-}"
[[ -n "$CONTRACT_ID" ]] || usage
shift

DOCKER=0
TARBALL=""
TARBALL_SHA256=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) DOCKER=1; shift ;;
    --tarball) TARBALL="${2:-}"; shift 2 ;;
    --tarball-sha256) TARBALL_SHA256="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

if [[ -n "$TARBALL" || -n "$TARBALL_SHA256" ]]; then
  [[ -n "$TARBALL" && -n "$TARBALL_SHA256" ]] || usage
  echo "==> Verifying $CONTRACT_ID from content-addressed tarball"
  echo "    tarball: $TARBALL"
  echo "    digest:  $TARBALL_SHA256"
  CLI_ARGS=(--id "$CONTRACT_ID" --tarball "$TARBALL" --tarball-sha256 "$TARBALL_SHA256")
  if [[ "$DOCKER" == 1 ]]; then
    CLI_ARGS+=(--docker)
  fi
  exec node "$ROOT/reader/dist/cli.js" verify "${CLI_ARGS[@]}"
fi

echo "==> [1/3] Rebuilding sample contract from source ($([[ "$DOCKER" == 1 ]] && echo docker || echo local))"
if [[ "$DOCKER" == 1 ]]; then
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
