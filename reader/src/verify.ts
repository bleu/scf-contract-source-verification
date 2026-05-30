import { readFile } from "node:fs/promises";
import { sha256Hex, normalizeHashHex } from "./hash.js";
import { ChainReader } from "./chain-reader.js";
import { extractContractMetaSection } from "./contractmeta.js";

/**
 * Verdict model, mirroring Sourcify's full/partial-match semantics adapted to
 * Soroban's hash-addressed ContractCodeEntry:
 *
 *  - FULL_MATCH:          rebuilt WASM is byte-identical to on-chain WASM
 *                         (sha256 equal). The deployed blob IS the source.
 *  - METADATA_ONLY_MATCH: WASM differs ONLY in the `contractmetav0` custom
 *                         section (behaviorally identical). Sourcify "partial
 *                         match" analogue. (Detected structurally in the MVP;
 *                         a strict XDR section-diff is a Testnet-tranche item.)
 *  - NO_MATCH:            hashes differ and the difference is not metadata-only.
 *  - ERROR:               could not fetch/compare (network, bad ID, etc.).
 */
export type Verdict =
  | "FULL_MATCH"
  | "METADATA_ONLY_MATCH"
  | "NO_MATCH"
  | "ERROR";

export interface VerificationResult {
  verdict: Verdict;
  contractId?: string;
  network: string;
  onChainSha256?: string;
  rebuiltSha256: string;
  onChainByteLength?: number;
  rebuiltByteLength: number;
  /** True only when verdict === FULL_MATCH. */
  match: boolean;
  detail: string;
}

export interface VerifyByIdOptions {
  contractId: string;
  /** Path to the locally rebuilt .wasm to compare against the chain. */
  rebuiltWasmPath: string;
  network?: string;
}

/**
 * Verify a deployed contract by ID: fetch on-chain WASM, hash it, and compare
 * against the SHA-256 of a locally rebuilt WASM file.
 */
export async function verifyById(
  opts: VerifyByIdOptions,
): Promise<VerificationResult> {
  const network = opts.network ?? "testnet";
  const rebuilt = await readFile(opts.rebuiltWasmPath);
  const rebuiltBytes = new Uint8Array(rebuilt);
  const rebuiltSha256 = sha256Hex(rebuiltBytes);

  let onChain;
  try {
    const reader = new ChainReader(network);
    onChain = await reader.fetchWasmByContractId(opts.contractId);
  } catch (err) {
    return {
      verdict: "ERROR",
      contractId: opts.contractId,
      network,
      rebuiltSha256,
      rebuiltByteLength: rebuiltBytes.byteLength,
      match: false,
      detail: `Failed to fetch on-chain WASM: ${(err as Error).message}`,
    };
  }

  return compareWasm({
    contractId: opts.contractId,
    network,
    onChainBytes: onChain.wasm,
    onChainSha256: onChain.sha256,
    rebuiltBytes,
    rebuiltSha256,
  });
}

/**
 * Pure comparison of two WASM byte buffers (no network). Exposed so tests can
 * exercise the full/metadata-only/no-match decision deterministically.
 */
export function compareWasm(args: {
  contractId?: string;
  network: string;
  onChainBytes: Uint8Array;
  onChainSha256: string;
  rebuiltBytes: Uint8Array;
  rebuiltSha256: string;
}): VerificationResult {
  const {
    contractId,
    network,
    onChainBytes,
    onChainSha256,
    rebuiltBytes,
    rebuiltSha256,
  } = args;

  const base = {
    contractId,
    network,
    onChainSha256: normalizeHashHex(onChainSha256),
    rebuiltSha256: normalizeHashHex(rebuiltSha256),
    onChainByteLength: onChainBytes.byteLength,
    rebuiltByteLength: rebuiltBytes.byteLength,
  };

  if (base.onChainSha256 === base.rebuiltSha256) {
    return {
      ...base,
      verdict: "FULL_MATCH",
      match: true,
      detail:
        "Byte-for-byte match: rebuilt WASM SHA-256 equals the on-chain ContractCodeEntry hash.",
    };
  }

  // Strip the contractmetav0 section from both and re-compare. If the stripped
  // bodies are identical, the only difference was metadata.
  const onChainStripped = extractContractMetaSection(onChainBytes).stripped;
  const rebuiltStripped = extractContractMetaSection(rebuiltBytes).stripped;
  if (
    onChainStripped.byteLength === rebuiltStripped.byteLength &&
    sha256Hex(onChainStripped) === sha256Hex(rebuiltStripped)
  ) {
    return {
      ...base,
      verdict: "METADATA_ONLY_MATCH",
      match: false,
      detail:
        "WASM differs only in the contractmetav0 custom section; bytecode is otherwise identical (Sourcify partial-match analogue).",
    };
  }

  return {
    ...base,
    verdict: "NO_MATCH",
    match: false,
    detail:
      "Rebuilt WASM SHA-256 does not equal the on-chain hash, and the difference is not metadata-only.",
  };
}
