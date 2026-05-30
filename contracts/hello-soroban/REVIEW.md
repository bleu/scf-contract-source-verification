⚠️ **Testnet-only. NOT audited.** Soroban contracts here handle auth/funds and MUST be reviewed by Bleu's in-house Rust engineer before any mainnet use or "audited" claim.

# Review Banner — hello-soroban

This directory contains a **Soroban smart contract** (`hello-soroban`) used purely
as a verification fixture for the Soroscan Verify MVP. It is deployed to **Stellar
testnet only** and is **not audited**.

- Do **not** deploy this (or any contract generated/scaffolded here) to mainnet
  without a full review by Bleu's in-house Rust engineer.
- Do **not** present this code as production-ready or "audited".
- This fixture intentionally does nothing security-sensitive (it has no auth, no
  token transfers, no storage of funds) — it exists only so the verification
  pipeline has a real on-chain contract to rebuild and hash-match against.

## Testnet deployment (this fixture)

| Field | Value |
|-------|-------|
| Network | Stellar **testnet** |
| Contract ID | `CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB` |
| WASM hash (SHA-256) | `6fe7bd58e5a33dc27daefc74acfae6eb70f101fdbde860475cf18fde87288e4b` |
| WASM size | 1060 bytes |
| Toolchain | rust 1.91.1, stellar-cli 26.1.0, soroban-sdk 25.3.1, target `wasm32v1-none` |
| Deployer (testnet) | `GBWLKCOQVGRRQA27IYOIXL6HKBRMVD3TBPTWV3MHVCYXZCLFFTPK4Q26` |
| Upload tx | `0159a5825a1747ae76abb610c130fe42bd4de7d40fb0ba86c7338056faf8f971` |
| Deploy tx | `3f5517e986a8666fe8f9da401b2c8fe8d51d08ddd4e0e8cfb90be29d37266552` |
