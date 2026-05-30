import { createHash } from "node:crypto";

/**
 * Compute the SHA-256 of a WASM byte buffer, returned as a lowercase hex string.
 *
 * This is the verification primitive. When a contract is uploaded to Stellar
 * (`InvokeHostFunction` / UploadContractWasm), the ledger stores the bytecode in
 * a `ContractCodeEntry` keyed by the SHA-256 of the executable. A deployed
 * contract instance references that WASM by this hash. So "is the deployed blob
 * the published source?" reduces to: does sha256(rebuilt wasm) == on-chain hash?
 *
 * Verified empirically in this repo: `shasum -a 256` of the WASM produced by
 * `stellar contract build` equals the "Wasm Hash" the CLI reports, the hash the
 * ledger stores, and the hash of `stellar contract fetch` output. See README
 * "Verification primitive".
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Normalize a hex hash for comparison: lowercase, no `0x`, trimmed. */
export function normalizeHashHex(hash: string): string {
  return hash.trim().toLowerCase().replace(/^0x/, "");
}

/** Compare two hex hashes after normalization. */
export function hashesEqual(a: string, b: string): boolean {
  return normalizeHashHex(a) === normalizeHashHex(b);
}
