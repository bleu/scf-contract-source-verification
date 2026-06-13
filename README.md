> ⚠️ **Testnet-only. NOT audited.** This repo contains a Soroban smart contract
> (`contracts/hello-soroban`) used as a verification fixture. Soroban contracts
> here handle auth/funds and MUST be reviewed by Bleu's in-house Rust engineer
> before any mainnet use or "audited" claim. Do not present generated contract
> code as production-ready.

# Soroscan Verify — Soroban Contract Source Verification Service (MVP)

Open-source, **[SEP-0058]-native** source verification for Soroban contracts.
SEP-58 ("Contract Build Reproducibility for Verification") defines the metadata
a contract publishes so that anyone can re-run its build; Soroscan Verify is
the service that does the re-running: it reads the SEP-58 fields from the
deployed Wasm, rebuilds the source inside a pinned, network-isolated
build image, and byte-compares the result against the on-chain bytecode —
proving (or refuting) that *this source produces this Wasm*.

This repo is the working MVP of the service: the SEP-58 metadata reader, the
chain reader, the verdict and image-trust logic, the content-addressed tarball
flow, and a pinned build image — all tested against a live testnet fixture.
The full design — hosted multi-verifier service, `/v1` public API, UI, and
explorer integrations — is specified in
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (see [Roadmap](#roadmap)).

License: **Apache-2.0**.

## Why this exists

Soroban contracts are deployed as opaque Wasm blobs. When a contract is
uploaded, the ledger stores the bytecode in a `ContractCodeEntry` keyed by the
**SHA-256 of the executable**, and every contract instance references its code
by that hash. So source verification reduces to one testable question:

> **Can we rebuild a candidate source into a Wasm whose SHA-256 equals the
> hash the ledger reports for this contract?**

Two SEPs address contract trust from different angles, and they are
**complementary, not competing**:

- **[SEP-0055] (Contract Build Verification)** answers *"did a trusted CI
  pipeline build this Wasm from this repo?"* via GitHub artifact attestations
  — provenance from a named builder, available instantly, no rebuild cost.
- **[SEP-0058] (Contract Build Reproducibility for Verification)** answers
  *"does this source, in this environment, produce exactly these bytes?"* via
  independent re-execution on neutral infrastructure — the Soroban analogue of
  [Sourcify]'s bytecode-match model for Ethereum.

SEP-58's own text calls the two complementary, addressing the same trust
question with different trade-offs. A contract can and ideally does carry
both; the service exposes them as **distinct trust levels** (separate API
fields, never collapsed into one badge). This repo implements the SEP-58
rebuild side.

## The SEP-58 pipeline

Every SEP-58 field drives one step of the verification pipeline. The fields
normally travel in the Wasm's `contractmetav0` custom section ([SEP-0046] is
the underlying meta transport); the full service also accepts them as an
off-chain submission for contracts deployed before the tooling existed.

| SEP-58 field | Meaning | Pipeline step that consumes it |
|---|---|---|
| `bldimg` | Build container image, **pinned by digest** | **Image-trust lookup** (MVP): checked against [`docker/allowlist.json`](docker/allowlist.json) and reported as the `imageTrust` tier on every verify result. In the full service the rebuild worker also pulls this image by digest — never by tag. |
| `bldopt` | One build flag per entry (repeatable) | **Rebuild invocation**: each flag is appended, in order, to `stellar contract build` inside the container (hosted rebuild — roadmap; the MVP builds with the pinned `--locked` invocation and surfaces `bldopt` via `read`). |
| `source_repo` | HTTPS URL of the source repository | **Source acquisition, `public-repo` mode**: clone the repo (acquisition is roadmap; the field is parsed and surfaced by `read` today). |
| `source_rev` | Full 40-char commit SHA-1 | **Source acquisition, `public-repo` mode**: check out exactly this commit — branch and tag names are not accepted. |
| `tarball_url` | Where to download the source tarball | **Source acquisition, `hosted-tarball` mode**: download over HTTPS or IPFS (roadmap). |
| `tarball_sha256` | SHA-256 of the source tarball | **Integrity gate** (MVP): `verify --tarball` refuses to unpack or build a tarball whose digest doesn't match. On its own, it is the lookup key for `content-addressed` private source. |

From these fields the reader infers the contract's **source mode** — one per
conformant combination in SEP-58 §2:

| Source mode | SEP-58 fields present | Meaning |
|---|---|---|
| `public-repo` | `source_repo` + `source_rev` | Source is a VCS checkout at a pinned revision. |
| `hosted-tarball` | `tarball_url` + `tarball_sha256` | Source is a hosted archive pinned by digest. |
| `hosted-tarball-unpinned` | `tarball_url` alone | Verifier downloads and extracts, trusting the host (no digest pin). |
| `content-addressed` | `tarball_sha256` alone | Private source committed by digest only; the archive is handed to the verifier out of band. |
| `none` | — | No SEP-58 source identifiers found. |

## Architecture (data flow)

The diagram uses the SDK method names as they actually exist on
`@stellar/stellar-sdk`'s `rpc.Server` (`getContractWasmByContractId`,
`getContractWasmByHash`, `getLedgerEntries`) — confirmed present on
`rpc.Server.prototype` in the installed SDK (v15.1.0).

```mermaid
flowchart TD
    Dev[Developer / Auditor] -->|contract ID or wasm hash + SEP-58 source claim| UI[Verification UI - React/Next - roadmap]
    UI -->|POST /v1/verifications - roadmap| API[Public API - /v1 - roadmap]
    API -->|enqueue job| Q[Build Queue - roadmap]
    API -->|fetch on-chain wasm| Reader[Chain Reader - stellar-sdk RPC - MVP]
    Reader -->|getContractWasmByContractId / getContractWasmByHash| RPC[(Stellar RPC - ContractCodeEntry - SHA-256 hash)]
    Reader -->|SEP-58 fields from contractmetav0 - bldimg bldopt source_repo source_rev tarball_url tarball_sha256| API
    Reader -->|bldimg digest| Allow{Allowlist lookup - docker/allowlist.json - MVP}
    Allow -->|imageTrust tier| Match
    Q --> Worker[Reproducible Build Worker - pinned Docker - MVP]
    Worker -->|pull pinned image by digest| Docker[(Build image - sdf-trusted or fallback - MVP)]
    Worker -->|repo@commit - roadmap - or digest-gated tarball - MVP| Git[(Source - repo / tarball / content-addressed)]
    Worker -->|stellar contract build --locked - target wasm32v1-none| WASM[Rebuilt WASM + SHA-256 - MVP]
    WASM -->|compare hash and section diff| Match{Match verdict + image trust - MVP}
    Match -->|FULL_MATCH / METADATA_ONLY_MATCH / NO_MATCH / ERROR| DB[(Verification registry - ed25519-signed results - roadmap)]
    DB -->|mirror artifacts| IPFS[(IPFS pin - roadmap)]
    DB --> Badge[Badge endpoint - GET /v1/badge/id.svg - roadmap]
    Badge --> Explorer[Explorers - Stellar Expert / Stellar Lab Contract Explorer - roadmap]
    DB --> Query[GET /v1/wasm/hash - GET /v1/contract/id - roadmap]
    Query --> UI
```

Pieces labeled **MVP** are implemented and tested in this repo. Pieces labeled
**roadmap** are specified in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) but
not built here.

## Stack (plain English)

- **SEP-58 metadata reader** (`reader/src/sep58.ts`): extracts the six SEP-58
  fields (`bldimg`, `bldopt` (repeatable), `source_repo`, `source_rev`,
  `tarball_url`, `tarball_sha256`) from the decoded meta entries and infers
  the source mode.
- **contractmeta reader** (`reader/src/contractmeta.ts`): parses the
  [SEP-0046] `contractmetav0` Wasm custom section — the transport the SEP-58
  fields travel in — and decodes its XDR `SCMetaEntry` records. Also powers
  the `METADATA_ONLY_MATCH` verdict (strip the section, re-compare).
- **Chain reader** (`reader/src/chain-reader.ts`): TypeScript over
  `@stellar/stellar-sdk` RPC. Fetches the on-chain Wasm + SHA-256 for a
  contract ID (`getContractWasmByContractId`) or a Wasm hash
  (`getContractWasmByHash`).
- **Image trust** (`reader/src/image-trust.ts`): derives the `imageTrust` tier
  for a contract's `bldimg` from [`docker/allowlist.json`](docker/allowlist.json).
- **Tarball flow** (`reader/src/tarball.ts`, `reader/src/builder.ts`):
  digest-gated unpacking of content-addressed source tarballs (path-traversal
  safe) and the rebuild step (local pinned toolchain or the pinned Docker
  image).
- **Verify CLI** (`reader/src/cli.ts`, bin `soroscan-verify`): `read` and
  `verify` subcommands — see [Quick start](#quick-start).
- **Pinned build image** (`docker/Dockerfile`): the repo's fallback toolchain
  image — see [Build images](#build-images-primary-path-and-fallback).
- **Sample contract** (`contracts/hello-soroban`): a minimal `soroban-sdk`
  contract, deployed to testnet, that the pipeline rebuilds and hash-matches.
  Rust, `wasm32v1-none`, built with `stellar contract build --locked`.

## Verification primitive (verified in this repo)

`shasum -a 256` of the WASM produced by `stellar contract build` equals (a) the
"Wasm Hash" the CLI prints, (b) the hash the ledger stores in the
`ContractCodeEntry` (confirmed by `stellar contract fetch` of the deployed
fixture), and (c) the hash the TypeScript reader computes from the WASM it pulls
over RPC. All are:

```
6fe7bd58e5a33dc27daefc74acfae6eb70f101fdbde860475cf18fde87288e4b
```

### Verdict model (Sourcify analogue)

Every verification carries two orthogonal dimensions: the **match verdict**
(did the rebuild reproduce the bytes?) and the **image trust tier** (how
trustworthy is the environment that the contract claims built it?).

| Verdict | Meaning |
|---------|---------|
| `FULL_MATCH` | Rebuilt WASM is byte-identical to on-chain WASM (SHA-256 equal). The deployed blob **is** the source. |
| `METADATA_ONLY_MATCH` | WASM differs **only** in the `contractmetav0` custom section (behaviorally identical) — Sourcify "partial match" analogue. |
| `NO_MATCH` | Hashes differ and the difference is not metadata-only. |
| `ERROR` | Could not fetch/compare (network, malformed ID, tarball digest mismatch, etc.). |

### Image trust (orthogonal to the verdict)

Reproducibility alone is not faithfulness to source: a hostile build image can
deterministically rewrite bytes and still pass byte-comparison. So every verify
result also carries an `imageTrust` tier, derived by looking up the contract's
SEP-58 `bldimg` in the checked-in [`docker/allowlist.json`](docker/allowlist.json):

| Tier | Meaning |
|------|---------|
| `sdf-trusted` | Image digest is on the SDF-trusted allowlist (official `stellar-cli-docker` releases). |
| `publicly-auditable` | Image is allowlisted as a publicly-auditable third-party image (e.g. this repo's pinned toolchain image). |
| `arbitrary` | A `bldimg` was declared but is not allowlisted. |
| `unknown` | No `bldimg` metadata available. |

A `FULL_MATCH` from an `arbitrary` image is weaker evidence of faithfulness to
source than one from an allowlisted image — which is why the two dimensions are
reported together but never merged.

## Build images: primary path and fallback

The **primary path** is SDF-published build images: contracts declare a
`bldimg` pointing at a `stellar/stellar-cli` image from
[stellar-cli-docker] — which is explicitly SEP-58-compatible and itself
mandates digest pinning — and the verifier checks that digest against the
allowlist, granting the `sdf-trusted` tier. The allowlist file documents the
exact entry shape for these images; their published digests are recorded as
SDF releases them.

This repo's own pinned image (`docker/Dockerfile`, recorded in
[`docker/toolchain-manifest.json`](docker/toolchain-manifest.json)) is the
**interim/fallback** image: a publicly-auditable toolchain (pinned rustc,
`stellar-cli`, and Wasm target, built from a checked-in Dockerfile, run with
`--network=none` during compile) used for local verification and for contracts
that don't reference an SDF image. It is allowlisted at the
`publicly-auditable` tier, deliberately below `sdf-trusted`.

```bash
# Build the image (repo root as context: the fixture's locked dependency
# graph is prefetched into the image, so the actual compile can run with
# --network=none and never fetch — the staged source-acquisition model from
# docs/ARCHITECTURE.md §8).
docker build -f docker/Dockerfile -t soroscan-verify-builder:rust-1.91.1-cli-26.1.0 .

# Rebuild the contract network-isolated and check the hash
docker run --rm --network=none \
  -v "$PWD/contracts":/work \
  soroscan-verify-builder:rust-1.91.1-cli-26.1.0
shasum -a 256 contracts/target/wasm32v1-none/release/hello_soroban.wasm
```

For true reproducibility the image must be referenced **by digest**, like any
SEP-58 `bldimg`. This repo's image is currently built locally and pinned by
version tag only — its registry digest is recorded in
[`docker/toolchain-manifest.json`](docker/toolchain-manifest.json) and
[`docker/allowlist.json`](docker/allowlist.json) once the image is published
(both carry an explicit placeholder until then).

**Allowlist eviction downgrades; it never deletes.** If a digest is removed
from the allowlist — say a vulnerability turns up in an image — past
verifications that used it keep their records; only the trust tier reported
for them is downgraded. Trust signals age; evidence does not.

## Quick start

Prereqs: `rust 1.91.1`, `nodejs 24.11.0` (see `.tool-versions`), `stellar` CLI
26.1.0, `pnpm`. `wasm32v1-none` target installed.

```bash
# 1. Build + test the sample contract (produces the WASM)
cd contracts
cargo test --locked
stellar contract build --locked          # -> target/wasm32v1-none/release/hello_soroban.wasm

# 2. Build the reader/CLI
cd ../reader
pnpm install
pnpm test                                # unit tests (no network)
pnpm run build

# 3. Read the on-chain WASM hash + SEP-58 source metadata for the deployed
#    fixture: prints the contractmetav0 entries, the SEP-58 fields, and the
#    inferred source mode (also accepts --wasm-hash <hex> instead of --id)
node dist/cli.js read \
  --id CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB

# 4. Verify by ID: rebuild-compare against the chain. Prints the verdict and
#    the imageTrust tier; exit 0 only on FULL_MATCH.
node dist/cli.js verify \
  --id CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB \
  --wasm ../contracts/target/wasm32v1-none/release/hello_soroban.wasm

# 5. Verify from a content-addressed source tarball (the SEP-58
#    tarball_sha256 commitment model): the digest is checked FIRST — a tarball
#    that doesn't match is never unpacked or built — then the source is
#    unpacked to a fresh temp dir, rebuilt, and compared. --docker rebuilds
#    inside the pinned image (build it first — see "Build images" above).
#    Omitting --docker uses the local toolchain, which must be rust 1.91.1
#    *outside* the repo tree too: the rebuild runs in a temp dir, where
#    directory-scoped version managers (asdf, direnv) won't see .tool-versions.
tar -czf /tmp/hello-soroban-src.tar.gz -C ../contracts Cargo.toml Cargo.lock hello-soroban
node dist/cli.js verify \
  --id CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB \
  --tarball /tmp/hello-soroban-src.tar.gz \
  --tarball-sha256 "$(shasum -a 256 /tmp/hello-soroban-src.tar.gz | cut -d' ' -f1)" \
  --docker
```

All subcommands take `--json` for machine-readable output. Or run the whole
thing via the driver:

```bash
scripts/verify.sh CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB
# add --docker to build inside the pinned image;
# add --tarball <path> --tarball-sha256 <digest> for the tarball flow
```

## Live testnet fixture

| Field | Value |
|-------|-------|
| Network | Stellar **testnet** |
| Contract ID | `CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB` |
| WASM hash (SHA-256) | `6fe7bd58e5a33dc27daefc74acfae6eb70f101fdbde860475cf18fde87288e4b` |
| WASM size | 1060 bytes |
| Toolchain | rust 1.91.1, stellar-cli 26.1.0, soroban-sdk 25.3.1, `wasm32v1-none` |
| Explorer | https://stellar.expert/explorer/testnet/contract/CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB |

The live chain-read test is opt-in: `SOROSCAN_INTEGRATION=1 pnpm exec vitest run
test/integration.testnet.test.ts`.

## Reproducibility & honest caveats

- **Determinism is shown, not assumed.** `stellar contract build --locked`
  asserts `Cargo.lock` is unchanged (the documented reproducible-build lever).
  Two clean rebuilds on this toolchain produce the identical hash above, matching
  the on-chain WASM. The Stellar docs do **not** guarantee byte-for-byte
  reproducibility or `wasm-opt`/`--optimize` determinism across machines — that is
  an open question handled by pinning the full toolchain via Docker image digest
  and by the `METADATA_ONLY_MATCH` verdict for behaviorally-identical builds.
- **TESTNET ONLY.** No mainnet config is wired up; `resolveNetwork` rejects
  anything but `testnet`. (The full service runs against both networks —
  roadmap phase 2.)
- **The fixture predates the SEP-58 stamping tooling**, so its on-chain
  metadata carries no SEP-58 fields (`read` reports source mode `none` and
  `verify` reports `imageTrust: unknown`). That is exactly the population the
  retroactive, off-chain submission path in
  [docs/ARCHITECTURE.md §7](docs/ARCHITECTURE.md) exists for; contracts built
  with the in-progress `stellar contract build --verifiable`
  ([stellar-cli#2585]) get the fields stamped in automatically.
- **Soroban SDK version.** This fixture pins `soroban-sdk =25.3.1`, the version
  OpenZeppelin's `stellar-contracts` `0.7.1` requires (`^25.3.0`, verified via the
  crates.io sparse index) — Bleu's validated default base. OZ-composed contracts
  reproduce on this same SDK; real submissions select their build image by the
  SEP-58 `bldimg` they advertise.

## Roadmap

This repo is the MVP core; the full plan, with an objective completion test
per phase, is in [docs/ARCHITECTURE.md §11](docs/ARCHITECTURE.md). In summary:

| Milestone | Scope | Done when |
|-----------|-------|-----------|
| **MVP (this repo)** | SEP-58 metadata reader, chain reader, verdict + image-trust logic, content-addressed tarball flow, pinned build image, deterministic hash-match proof on testnet. | Shipped — see [Quick start](#quick-start). |
| 1 — Self-hostable verifier core | ed25519 result signing, allowlist enforcement with downgrade semantics, all three SEP-58 source modes with IPFS and the artifact store, sandboxed rebuild workers, written threat model. | A third party can stand up a full verifier from docs alone and verify the MVP fixture end to end. |
| 2 — Security audit and hosted deployment | Independent security audit; hosted service live on **testnet + mainnet**, including the retroactive (off-chain metadata) submission path. | Audit report and remediations public; `GET /v1/contract/{id}` answers for both networks in production. |
| 3 — Stable API, SDK, and docs | `GET /v1/contract/{id}`, `GET /v1/wasm/{hash}`, `POST /v1/verifications`, `GET /v1/verifiers`; client SDK; allowlist governance policy published. | An integrator goes from docs to rendering verification state without contacting us; the under-15-minute walkthrough passes in CI. |
| 4 — Integrations | Badge endpoint (`GET /v1/badge/{contractId}.svg`), explorer embed, stellar-cli interaction in whichever shape the ecosystem standardizes, partner reference integration. | A partner surface renders results in production for both networks. |
| 5 — Production operations | Runbook, monitoring, status page, on-call, peer-operator support. | SLO dashboards public; at least one external peer verifier running or in progress. |

## References

- [SEP-0058] Contract Build Reproducibility for Verification (`bldimg`, `bldopt`, `source_repo`, `source_rev`, `tarball_url`, `tarball_sha256`)
- [SEP-0055] Contract Build Verification (GitHub-Attestation provenance — the complementary trust level; formalized from [discussion #1573])
- [SEP-0046] Contract Meta (`contractmetav0` / SCMetaEntry — the transport SEP-58 fields travel in)
- [stellar-cli-docker] — SDF-published `stellar/stellar-cli` images (the primary `bldimg` path)
- [stellar-cli#2585] `stellar contract build --verifiable` and [stellar-cli#2586] `stellar contract verify` — the in-progress local half of the SEP-58 story
- Stellar CLI manual — `stellar contract build` (`--locked`, `--meta`, `--optimize`)
- "Sha256 hash of the executable" — Stellar upgrading-contracts docs
- Retrieve a contract code ledger entry (LedgerKeyContractCode / getLedgerEntries)
- `@stellar/stellar-sdk` `rpc.Server` API reference (method names)
- [Sourcify] — Ethereum source verification (full vs partial match) prior art
- OpenZeppelin `stellar-contracts` (Rust Soroban library)
- Service design & roadmap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

[SEP-0046]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0046.md
[SEP-0055]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0055.md
[SEP-0058]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0058.md
[discussion #1573]: https://github.com/orgs/stellar/discussions/1573
[Sourcify]: https://github.com/ethereum/sourcify
[stellar-cli-docker]: https://github.com/stellar/stellar-cli-docker
[stellar-cli#2585]: https://github.com/stellar/stellar-cli/pull/2585
[stellar-cli#2586]: https://github.com/stellar/stellar-cli/pull/2586
