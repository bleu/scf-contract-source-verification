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
# Build:
#   docker build -t soroscan-verify-builder:rust-1.91.1-cli-26.1.0 ./docker
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

# Reproducibility levers:
#   SOURCE_DATE_EPOCH stabilizes any timestamp-derived bytes.
ENV SOURCE_DATE_EPOCH=1700000000 \
    CARGO_TERM_COLOR=never \
    RUST_BACKTRACE=0

# wasm32v1-none is the current Soroban build target (requires Rust >= 1.84).
RUN rustup target add wasm32v1-none

# Install the pinned stellar-cli. cargo-install from crates.io keeps the image
# self-contained and version-locked. (--locked uses the crate's own lockfile.)
RUN cargo install --locked stellar-cli --version ${STELLAR_CLI_VERSION}

WORKDIR /work

# Default: deterministic, network-isolated build of the mounted workspace.
# `--locked` asserts Cargo.lock is unchanged (the documented reproducible-build
# lever). `--optimize` (wasm-opt) runs by default on `stellar contract build`.
ENTRYPOINT ["stellar", "contract", "build", "--locked"]
CMD []
