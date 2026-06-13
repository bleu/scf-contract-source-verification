# Pitch Video Script — Soroscan Verify (SCF #44)

Target: **2:15–2:30 total** (form limit <3:00). Format: 16:9, 1920×1080,
YouTube unlisted. Two visual layers only: (1) full-screen terminal, (2) a
browser tab on stellar.expert / Stellar Lab. No slides needed.

**Prep before recording (do once, off-camera):**

```bash
# Warm everything so the on-camera run is fast and clean:
docker build -t soroscan-verify-builder:rust-1.91.1-cli-26.1.0 ./docker
cd reader && pnpm install && pnpm run build && cd ..
# Dry-run the money shot:
scripts/verify.sh CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB --docker
```

Use a large terminal font (≥18pt), dark theme, window sized to 16:9.

---

## 0:00–0:30 — The problem (browser)

**Screen:** Stellar Lab Contract Explorer on any contract with the "Build
Verified" badge. Hover/zoom the badge disclaimer text.

**Voiceover:**

> "Every Soroban contract on Stellar is deployed as an opaque WASM blob.
> Today, the closest thing to source verification is this badge — and
> Stellar's own explorer says it 'does not verify the source code.' It only
> attests that a GitHub Action ran. If the source you're reading matches the
> bytes on chain, you currently have to take someone's word for it."

**Screen at ~0:25:** cut to the stellar.expert testnet page for
`CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB`, pointing at the
WASM hash.

---

## 0:30–1:30 — The demo (terminal)

**Voiceover (over typing):**

> "Soroscan Verify closes that gap with reproducible builds. The Stellar
> ledger stores every contract executable under its SHA-256 hash. So we
> re-compile the published source ourselves — inside a pinned, network-isolated
> Docker toolchain — and compare hashes. No attestations, no trust."

**Screen — run, in order:**

```bash
# 1. Read the on-chain WASM hash straight from Stellar RPC
node reader/dist/cli.js read \
  --id CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB
```

**Voiceover while output prints:**

> "First, the chain reader pulls the contract's WASM and its hash directly
> from Stellar RPC — this is what the ledger says is deployed — along with its
> SEP-58 build metadata: which image, which flags, which source."

```bash
# 2. Rebuild from source in the pinned image and verify
scripts/verify.sh CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB --docker
```

**Voiceover while it builds (trim dead time in edit):**

> "Now the full pipeline: clone the source, build it with a pinned rustc and
> stellar-cli inside Docker with networking disabled, hash the result, and
> compare against the chain."

**Screen at the verdict:** zoom/highlight the two identical SHA-256 hashes and
the `FULL_MATCH` verdict + exit code 0.

**Voiceover:**

> "Byte-for-byte identical. FULL_MATCH means the deployed blob *is* the
> source — and anyone can re-run this exact build by image digest and get the
> same answer. Mismatches get a Sourcify-style verdict gradient, and every
> result also carries an image-trust tier, because a reproducible build in an
> untrusted image proves nothing."

---

## 1:30–2:00 — What the grant funds (terminal or README roadmap on screen)

**Voiceover:**

> "This working MVP is the verification primitive. The SCF grant turns it
> into shared public infrastructure: a free verify-once-read-many API, all
> three SEP-58 source modes, e-d-25519-signed results from self-hostable
> verifiers — so no one has to trust a single operator — a web UI with a diff
> viewer, IPFS-anchored evidence, and badges explorers can embed. Final
> milestone: live on mainnet."

---

## 2:00–2:15 — Who & close (terminal with repo URL, or face cam if comfortable)

**Voiceover:**

> "We're Bleu — a product engineering studio with thirty-plus months of
> continuous CoW Protocol contribution and production work for Balancer,
> Morpho, and Silo Finance. The code is open source, Apache-2.0, on GitHub
> today — and this is the working answer to the Contract Source Verification
> Service RFP. Thanks."

**Screen:** `github.com/bleu/scf-contract-source-verification` + project name.

---

## Editing notes

- Cut the Docker build wait — jump-cut to the verdict; keep total under 2:30.
- Keep both hashes on screen simultaneously for ≥3 seconds; that's the proof.
- Record voiceover separately from the terminal capture if pacing is hard.
