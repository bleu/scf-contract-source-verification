# SCF #44 Submission — Soroscan Verify

> Working draft for the SCF Build Award form. Fields marked `TODO` need an
> asset or an async answer before submitting (deadline: June 14, 2026).

---

## Project

**Soroscan Verify — Soroban Contract Source Verification Service**

## Round

SCF #44 (June 14, 2026)

## Build Award Track

**RFP track** — responding to the published RFP: **"Contract Source Verification Service"**.

## Submission Title

**Soroscan Verify — Reproducible-Build Source Verification for Soroban Contracts**

## Project Type

Formal Verification Tool

## Project URL

https://github.com/bleu/scf-contract-source-verification

## Technical Architecture Document

https://github.com/bleu/scf-contract-source-verification/blob/main/docs/ARCHITECTURE.md

## GitHub URL

https://github.com/bleu/scf-contract-source-verification

## Video URL

`TODO: record per docs/video-script.md, upload to YouTube (unlisted, 1920×1080, <3 min), paste URL.`

---

## Products & Services

Soroscan Verify is a source verification service for Soroban contracts. It
answers one question: is the source code someone published really the code
running on chain? To answer it, the service rebuilds the published source in a
controlled build environment and compares the SHA-256 hash of the rebuilt Wasm
against the hash stored in the ledger's `ContractCodeEntry`. If the hashes
match, the deployed contract and the published source are byte-for-byte the
same.

This is the rebuild model described in SEP-58. It complements SEP-55, which
answers a different question: whether a trusted CI pipeline built the
contract. Ethereum has had this layer for years through Sourcify; Soroban does
not have it yet. The full service design and trust model are written up in
the architecture document, and the verification core is already built,
tested, and proven against testnet in this repo.

**What works today** (open source, Apache-2.0):

- A chain reader that fetches deployed Wasm from Stellar RPC
  (`getContractWasmByContractId` / `getContractWasmByHash`) by contract ID or
  hash.
- A metadata reader that decodes the `contractmetav0` section, extracts all
  six SEP-58 fields (`bldimg`, `bldopt`, `source_repo`, `source_rev`,
  `tarball_url`, `tarball_sha256`), and works out which source mode applies
  per SEP-58 §2.
- A deterministic rebuild environment: a Docker toolchain pinned by digest,
  running `stellar contract build --locked` with networking disabled
  (`--network=none`). The resolved digests are published in a toolchain
  manifest, and stellar-cli is installed from pinned release binaries.
- A graded verdict, modeled on Sourcify: `FULL_MATCH`, `METADATA_ONLY_MATCH`
  (the Wasm differs only in its `contractmetav0` section, so behavior is
  identical), `NO_MATCH`, and `ERROR`. The CLI exits 0 only on `FULL_MATCH`,
  so it can gate a CI pipeline.
- An image-trust signal carried alongside the verdict. Each result records
  whether the contract's `bldimg` digest is on an allowlist seeded with
  SDF-published `stellar-cli-docker` digests, and assigns a tier
  (`sdf-trusted` / `publicly-auditable` / `arbitrary` / `unknown`). This
  matters because a build that reproduces inside a malicious image proves
  nothing. If an image is later removed from the allowlist, old results are
  downgraded rather than deleted, so the evidence stays.

**What this grant funds** (specified in docs/ARCHITECTURE.md):

- A self-hostable verifier that signs its results. Verification records are
  signed with ed25519 and stored in an append-only registry. Rebuilds run in
  sandboxed workers with a written threat model. All three SEP-58 source
  modes are supported: public repo, hosted tarball (with IPFS as a first-tier
  retrieval channel), and content-addressed private source. Anyone can run a
  verifier (an explorer, an auditor, SDF itself); ours is simply the first
  instance. Stellar usage: SEP-58 end-to-end, SEP-46 metadata, Stellar RPC on
  testnet and mainnet.
- A free public `/v1` API: `GET /v1/contract/{id}`, `GET /v1/wasm/{hash}`,
  `POST /v1/verifications`, and `GET /v1/verifiers`. Verification is keyed by
  Wasm hash, so verifying once covers every contract instance that shares the
  bytecode, and an upgrade cannot leave a stale badge behind. Versioning is
  strictly additive, and we commit to implementing the forthcoming
  verifier-API SEP once it settles. This lets explorers, wallets, and
  Stellar Lab show verification status without running a rebuild themselves.
- Retroactive verification. Contracts deployed before this tooling existed
  can submit their SEP-58 metadata off-chain. The verdict is just as strong
  either way, because metadata fields are tested during the rebuild rather
  than taken on trust. This makes the existing population of deployed
  contracts verifiable without redeployment.
- A web UI and developer flow. Paste a contract ID, get the SEP-58 fields
  pre-filled from `contractmetav0`, watch the rebuild, and inspect
  section-level diffs when there is a mismatch. The service builds on the
  in-progress `--verifiable` / `contract verify` work in stellar-cli
  (PRs #2585/#2586) as an aggregation layer above it. Target: a developer
  goes from reading the docs to a verified contract in under 15 minutes,
  enforced in CI against the live deployment.
- Automatic verification. A ledger monitor follows testnet and mainnet for
  new Wasm uploads, decodes `contractmetav0`, and verifies any contract
  carrying complete SEP-58 metadata with no submission step at all — the
  layer (Sourcify's chain monitor) that made verification ubiquitous on
  Ethereum. The same machinery detects contract upgrades and delivers
  signed webhooks, so integrators learn immediately when a verified
  contract starts running different code instead of polling for it.
- Integrations: a badge endpoint (`GET /v1/badge/{id}.svg` showing verdict
  and trust tier), a dependency-free explorer embed that shows each
  verifier's result separately (including disagreements between verifiers),
  a TypeScript SDK that lets integrators choose which verifiers to trust,
  and a GitHub Action that submits verification as a deploy step and fails
  the workflow on anything but `FULL_MATCH` — making verification a
  one-line addition to a CI deploy pipeline, the role
  `forge verify-contract` plays on Ethereum. Mainnet launch is the final
  milestone.

Beyond the grant scope, the same foundations extend to a public coverage
dashboard (the percentage of deployed mainnet Wasm that is verified — the
ecosystem-health metric Ethereum gained once verification became routine)
and a periodic open-data export of the verified-source repository,
mirroring Sourcify's public repository so reads never require trusting our
hosted instance.

Every component is Stellar-specific by construction: SEP-58 vocabulary
end-to-end, SEP-46 `contractmetav0`, SEP-55 attestations shown as a separate
complementary signal, Stellar RPC reads, and `stellar contract build
--locked` on `wasm32v1-none` as the reproducibility mechanism.

---

## Traction Evidence

The verification core is working code, proven against the chain. Every claim
below can be checked from the public repo:

- A live testnet fixture: contract
  `CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB`
  (https://stellar.expert/explorer/testnet/contract/CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB).
- A three-way hash match anyone can reproduce. The SHA-256 of the Wasm built
  from source (`6fe7bd58e5a33dc27daefc74acfae6eb70f101fdbde860475cf18fde87288e4b`)
  equals the hash the stellar CLI prints at upload, the hash the ledger
  stores in the `ContractCodeEntry`, and the hash the chain reader computes
  from the Wasm it fetches over RPC. Running `scripts/verify.sh
  <contract-id> --docker` reproduces this from a clean checkout inside the
  pinned image.
- SEP-58 is fully implemented in code. The reader
  decodes all six SEP-58 fields and infers the source mode per SEP-58 §2,
  including the unpinned hosted-tarball case and repeatable `bldopt`.
  Image-trust tiers checked against an allowlist are already part of the
  verify verdict.
- The repo has tests and CI: chain reader, SEP-46/SEP-58 metadata reader,
  verify CLI, image-trust signal, pinned Docker toolchain with a published
  digest manifest, and unit plus opt-in testnet integration tests, all
  public under Apache-2.0.
- The design is grounded in prior art. The architecture document analyzes
  Sourcify, solana-verifiable-build, Stellar Expert's SEP-55 build workflow,
  and stellar-cli PRs #2585/#2586, and says which parts transfer to Soroban
  and which have to be built natively, including the claim/evidence split
  and how to display results from multiple verifiers that disagree.

Demand for this service is established by the RFP itself: SDF published the
"Contract Source Verification Service" RFP because this layer is missing.
Stellar's own tooling documents the gap: the Stellar Lab Contract Explorer
states that its "Build Verified" badge "does not verify the source code."
This submission is a working answer to that gap.

---

## Resubmission Feedback

*(First-time submission — left blank.)*

## Ambassador Affiliation

`TODO: confirm async — answer honestly (likely "No").`

## Thumbnail

`TODO: 16:9 image (1920×1080). Suggested concept: terminal screenshot of
scripts/verify.sh ending in FULL_MATCH, with the project name and the two
identical SHA-256 hashes highlighted.`

## Team Members

Applying as a **team of individuals**:

José Ribeiro · Pedro Yves Fracari · Luiz Gustavo Abou Hatem de Liz ·
Fábio Mendes · Victoria Fracari · Bibiana Correa · Alejandro Perren

`TODO: each listed member needs an SCF account before they can be added in the form.`

## Team Description

Bleu is a product engineering studio of about 15 people, based in São Paulo
and Florianópolis and founded in 2022; the legal entity is bleu LTDA
(Brazil). We have contributed to CoW Protocol continuously for over 30
months and hold production engagements with Balancer, Morpho, Silo Finance,
Nuts Finance/Pike, and Perk (3+ years). The core grant team is two engineers
at full allocation plus fractional product, design, and GTM:

**José Ribeiro** — Founder & CEO. Owns commercial and Brazilian-anchor
negotiation; multisig signer. Led 15+ funded CoW DAO workstreams.
github.com/ribeirojose · linkedin.com/in/jose-fernando-ribeiro

**Pedro Yves Fracari** — Blockchain Engineer Lead, full allocation. Led CoW's
automated-orders service and data infrastructure, audit-preparation reviews
for Silo's lending contracts, and Pike's lending data indexer.
github.com/yvesfracari · linkedin.com/in/pyvesfracari

**Luiz Gustavo Abou Hatem de Liz** — Senior Engineer (Stellar), full
allocation. 6+ years in Web3; undergraduate thesis on Drex (Brazil's central
bank digital currency). github.com/lgahdl

**Fábio Mendes** — Co-founder; Director of Product at Balancer.
github.com/mendesfabio · linkedin.com/in/mendes-fabio

**Victoria Fracari** — Product Lead. Owned Optimism GovQuests end to end, a
governance-onboarding platform delivered for the Optimism Foundation; leads
B2B discovery and delivery. Background in tax law.
linkedin.com/in/victoria-fracari

**Bibiana Correa** — Design Lead. Leads design systems and user research
across Perk Admin V3 (loyalty SaaS) and GovQuests (Optimism governance).
Background in corporate law. linkedin.com/in/bbnscorrea

**Alejandro Perren** — GTM Lead. 15+ years in IT growth; built SOUTHWORKS'
Brazil go-to-market strategy for its LatAm expansion. Owns outbound and
channel partnerships, with direct relationships across Brazilian accounting
and consultancy networks. linkedin.com/in/alejandro-perren

---

## Budget & Tranche Deliverables

**Total request: $100,000 in XLM**, structured as:

- $72,000 for engineering: two engineers at full allocation for 18 weeks.
  Pedro Yves Fracari covers the SEP-58 pipeline, signing and registry, the
  `/v1` API, and the verification core. Luiz Gustavo Abou Hatem de Liz
  covers build-sandbox isolation, workers, the auto-verification monitor
  and webhooks, infrastructure, and integrations.
- $13,000 for fractional product and design: a product lead (submission
  flows, integrator discovery) and a design lead (UI, source browser, badge
  and embed surfaces).
- $15,000 for infrastructure during the grant period: build workers,
  continuous ledger polling and webhook delivery, Postgres with
  point-in-time recovery, IPFS pinning, CDN, monitoring and a status page,
  RPC access, and testnet plus mainnet hosting against a 99%
  read-availability target.

There is no marketing spend (GTM time is not budgeted) and no audit cost in
the budget. The third-party security audit is expected through SCF audit
credits at tranche #3, per SCF rules; the budget covers audit *preparation*
(threat model, sandbox review), not the audit itself.

Payout structure: Tranche #0 $10,000 (10%, upon approval) · Tranche #1
$20,000 (20%) · Tranche #2 $30,000 (30%) · Tranche #3 $40,000 (40% +
professional user testing, upon mainnet launch). The per-deliverable budgets
below sum to the tranche #1–#3 payouts; tranche #0 is the kickoff advance
against the same work.

### Tranche #1 Deliverables — Self-hostable verifier core (ARCHITECTURE.md Phase 1)

- **[Deliverable 1]** All three SEP-58 source modes through one resolver:
  public repo (`source_repo` plus a 40-character `source_rev`), hosted
  tarball with a SHA-256 integrity check and IPFS as a first-tier retrieval
  channel (`ipfs://` URIs accepted; HTTPS tarballs are pinned to IPFS after
  verification), and content-addressed private source. Every verification is
  anchored to a content-addressed source artifact in an append-only store.
  *Completion:* each mode verified end-to-end against the testnet fixture
  set; an integrity mismatch produces a hard `ERROR`. *Budget:* $7,500.
- **[Deliverable 2]** Signed results and allowlist enforcement. The verifier
  gets an ed25519 identity and signs a canonical encoding of each result
  (Wasm hash, source digest, verdict, `bldimg` digest, timestamp) into an
  append-only registry. The image allowlist is enforced with trust tiers,
  seeded from SDF-published `stellar-cli-docker` digests; removing an image
  downgrades its historical records instead of deleting them. *Completion:*
  results verify against the published key; eviction downgrades historical
  records without deleting them. *Budget:* $6,500.
- **[Deliverable 3]** Sandboxed rebuild workers and a written threat model.
  Builds run in ephemeral, unprivileged containers pulled by digest, with no
  network access during compilation, resource and time caps, a separate
  source-acquisition stage, and no secrets inside build containers. The
  threat model is published in the repo. *Completion:* a third party can
  stand up a full verifier from the docs alone and verify the MVP fixture
  end to end (Phase 1 exit test). *Budget:* $6,000.

**Tranche #1 Completion Date:** 6 weeks after approval

### Tranche #2 Deliverables — Hosted testnet service, `/v1` API, UI, SDK (Phases 2–3, testnet scope)

- **[Deliverable 1]** The public `/v1` API live on testnet:
  `GET /v1/contract/{id}`, `GET /v1/wasm/{hash}`, `POST /v1/verifications`
  (returns 202 with a job resource; submissions are deduplicated and
  rate-limited), and `GET /v1/verifiers`. Verification is keyed by Wasm
  hash. Includes the retroactive off-chain SEP-58 submission path and a
  published OpenAPI spec with an additive-only versioning policy and a
  standing commitment to conform to the verifier-API SEP. *Completion:* all
  four endpoints answering in production against testnet, with every verdict
  type demonstrable. *Budget:* $11,000.
- **[Deliverable 2]** Web UI and submission flows: paste a contract ID and
  get the SEP-58 fields pre-filled from `contractmetav0`, upload a tarball
  for modes 2 and 3, follow build status, and read a verdict page with a
  section diff viewer and per-verifier results. *Completion:* the
  docs-to-verified walkthrough takes under 15 minutes and runs in CI against
  the live deployment. *Budget:* $10,500.
- **[Deliverable 3]** TypeScript SDK, GitHub Action, and SEP-55 surfacing:
  a typed client for the four endpoints that lets integrators choose which
  verifiers to trust; a published GitHub Action that submits a contract for
  verification after deploy and fails the workflow on anything but
  `FULL_MATCH`, so verification becomes a one-step addition to a CI deploy
  pipeline; SEP-55 attestations are detected and exposed as a separate
  field next to the rebuild verdict. *Completion:* an integrator goes from
  docs to rendering verification state without contacting us, and a public
  example repo deploys and verifies a contract through the Action.
  *Budget:* $8,500.

**Tranche #2 Completion Date:** 12 weeks after approval

### Tranche #3 Deliverables — Mainnet launch, integrations, operations (Phases 2, 4–5, mainnet scope)

- **[Deliverable 1]** Mainnet launch and audit readiness. Lift the
  testnet-only guard and support mainnet RPC; harden for production
  (CDN-cached reads separated from the build path, point-in-time database
  backups, and queue backpressure that returns a 429 when the queue is
  full); hand an audit-readiness package (threat model, sandbox review) to
  the SCF audit-credit process; run professional user testing per SCF
  tranche #3 terms. *Completion:* service live on testnet and mainnet, with
  at least 10 mainnet contracts verified, including at least one retroactive
  submission. *Budget:* $14,000.
- **[Deliverable 2]** Integrations: a badge endpoint
  (`GET /v1/badge/{id}.svg` showing verdict and trust tier), a
  dependency-free explorer embed that renders each verifier's result
  separately, and integration docs. We will pursue a reference integration
  with the ecosystem teams named in ARCHITECTURE.md §12 (Stellar Lab,
  Stellar Expert/OrbitLens, Aha Labs, 57B). *Completion:* at least one
  partner surface rendering results in production, or an integration PR
  submitted with maintainer acknowledgement. *Budget:* $12,000.
- **[Deliverable 3]** Auto-verification monitor and upgrade webhooks. A
  ledger monitor follows testnet and mainnet for new Wasm uploads, decodes
  `contractmetav0`, and automatically queues a verification for any
  contract whose SEP-58 metadata is complete — no submission required, the
  role Sourcify's chain monitor plays on Ethereum. The same monitor detects
  contract upgrades and delivers signed webhooks so integrators learn
  immediately when a verified contract's code changes. Forward-only by
  design: pre-SEP-58 contracts carry no metadata to discover (Stellar RPC
  retains roughly a week of history, and the yield on older ledgers would
  be near zero) and are covered by the retroactive submission path instead.
  *Completion:* a contract deployed with complete SEP-58 metadata is
  verified with no human interaction, and an upgrade of a verified contract
  produces a webhook delivery. *Budget:* $6,000.
- **[Deliverable 4]** Production operations and peer-operator support:
  monitoring and alerting against the 99% read-availability target, a public
  status page, an operational runbook (RPC outages, backpressure, allowlist
  rollback), a retention and egress cost model, and a self-hosting guide for
  peer verifiers. *Completion:* SLO dashboards are public, and a third party
  can stand up a peer verifier from the docs alone. *Budget:* $8,000.

**Tranche #3 Completion Date:** 18 weeks after approval

---

## Legal Acknowledgements

Acknowledge and accept all statements as a **team of individuals** — per the
form's definition (ii), each listed team member acknowledges and accepts
individually. *(Checkboxes completed in the form itself.)*
