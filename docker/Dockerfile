# syntax=docker/dockerfile:1
#
# Soroscan Verify — pinned single-toolchain reproducible-build image (MVP).
#
# This image is the neutral, content-addressed build environment that makes
# source -> WASM matching independently re-runnable. Anyone can pull this image
# BY DIGEST, run the build, and re-derive the same SHA-256 as the on-chain
# ContractCodeEntry. That is the property GitHub-attestation approaches lack.
#
# Everything that can affect codegen is pinned:
#   - base OS layer (digest-pinnable; see note below)
#   - exact rustc/cargo version
#   - exact stellar-cli version
#   - the wasm32v1-none target
#
# Build (context = repo root, so the fixture's lockfile can be prefetched):
#   docker build -f docker/Dockerfile -t soroscan-verify-builder:rust-1.91.1-cli-26.1.0 .
#
# Run (compile a repo mounted at /work, network-isolated for determinism):
#   docker run --rm --network=none -v "$PWD/contracts":/work \
#     soroscan-verify-builder:rust-1.91.1-cli-26.1.0
#
# NOTE on pinning: for true reproducibility, pin the base image by digest
# (FROM rust:1.91.1-bookworm@sha256:...) and publish that digest in the
# toolchain manifest. We use the version tag here for readability; the
# accompanying toolchain-manifest.json records the resolved digest at build time.

# --- Pinned Rust toolchain (matches this repo's .tool-versions: rust 1.91.1) ---
FROM rust:1.91.1-bookworm

# Pinned stellar-cli version (matches the locally verified 26.1.0).
ARG STELLAR_CLI_VERSION=26.1.0
# SHA-256 of the official release tarballs for ${STELLAR_CLI_VERSION}, per arch.
ARG STELLAR_CLI_SHA256_AMD64=e18d5a7629102e1ccc07241acbcbebfc05b1c02476ce7d3204ba2d7418be5c0c
ARG STELLAR_CLI_SHA256_ARM64=5cd2577d296509f05cfd96e9b3e9d8da70967aafd4063bae4da1e01e0132aacc
# Set automatically by BuildKit: amd64 | arm64
ARG TARGETARCH

# Reproducibility levers:
#   SOURCE_DATE_EPOCH stabilizes any timestamp-derived bytes.
ENV SOURCE_DATE_EPOCH=1700000000 \
    CARGO_TERM_COLOR=never \
    RUST_BACKTRACE=0

# wasm32v1-none is the current Soroban build target (requires Rust >= 1.84).
RUN rustup target add wasm32v1-none

# libdbus is a runtime dependency of the official stellar-cli release binary
# (it links libdbus-1.so.3 for OS keychain access) and is not in the rust base
# image.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends libdbus-1-3; \
    rm -rf /var/lib/apt/lists/*

# Install the pinned stellar-cli from the official release tarball, verified by
# SHA-256. We intentionally do NOT `cargo install` it: stellar-cli 26.1.0 needs
# rustc >= 1.93 to compile, while this image's rustc must stay at the pinned
# 1.91.1 used for contract codegen. The compiler that built the CLI binary has
# no effect on the contract WASM — `stellar contract build` shells out to this
# image's cargo/rustc.
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) triple="x86_64-unknown-linux-gnu";  sha256="${STELLAR_CLI_SHA256_AMD64}" ;; \
      arm64) triple="aarch64-unknown-linux-gnu"; sha256="${STELLAR_CLI_SHA256_ARM64}" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/stellar-cli.tar.gz \
      "https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_CLI_VERSION}/stellar-cli-${STELLAR_CLI_VERSION}-${triple}.tar.gz"; \
    echo "${sha256}  /tmp/stellar-cli.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/stellar-cli.tar.gz -C /usr/local/bin stellar; \
    rm /tmp/stellar-cli.tar.gz; \
    stellar version

# Prefetch the fixture workspace's locked dependency graph into the image's
# cargo home, using only the manifests and Cargo.lock (a stub lib.rs satisfies
# target discovery; no contract code is compiled into the image). This is the
# staged source-acquisition model from docs/ARCHITECTURE.md §8: dependencies
# arrive while the image is built, so the actual build can run with
# --network=none and never fetch.
COPY contracts/Cargo.toml contracts/Cargo.lock /tmp/prefetch/
COPY contracts/hello-soroban/Cargo.toml /tmp/prefetch/hello-soroban/
RUN set -eux; \
    mkdir -p /tmp/prefetch/hello-soroban/src; \
    touch /tmp/prefetch/hello-soroban/src/lib.rs; \
    cargo fetch --locked --manifest-path /tmp/prefetch/Cargo.toml; \
    rm -rf /tmp/prefetch

WORKDIR /work

# Default: deterministic, network-isolated build of the mounted workspace.
# `--locked` asserts Cargo.lock is unchanged (the documented reproducible-build
# lever). `--optimize` (wasm-opt) runs by default on `stellar contract build`.
ENTRYPOINT ["stellar", "contract", "build", "--locked"]
CMD []
