import { readFile, rm } from "node:fs/promises";
import { sha256Hex, normalizeHashHex, hashesEqual } from "./hash.js";
import { ChainReader } from "./chain-reader.js";
import { extractContractMetaSection } from "./contractmeta.js";
import { unpackTarball } from "./tarball.js";
import {
  deriveImageTrust,
  loadAllowlist,
  type AllowlistEntry,
  type ImageTrustTier,
} from "./image-trust.js";

/**
 * Verdict model, mirroring Sourcify's full/partial-match semantics adapted to
 * Soroban's hash-addressed ContractCodeEntry:
 *
 *  - FULL_MATCH:          rebuilt WASM is byte-identical to on-chain WASM
 *                         (sha256 equal). The deployed blob IS the source.
 *  - METADATA_ONLY_MATCH: WASM differs ONLY in the `contractmetav0` custom
 *                         section (behaviorally identical). Sourcify "partial
 *                         match" analogue. (Detected structurally in the MVP;
 *                         a strict XDR section-diff is roadmap work; see
 *                         docs/ARCHITECTURE.md.)
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
  /** Unset only when verification errored before a rebuilt WASM existed. */
  rebuiltSha256?: string;
  onChainByteLength?: number;
  rebuiltByteLength?: number;
  /** True only when verdict === FULL_MATCH. */
  match: boolean;
  /**
   * How trustworthy the declared build image is — orthogonal to the verdict.
   * A FULL_MATCH from an arbitrary image is weaker evidence of faithfulness
   * to source than one from an allowlisted image.
   */
  imageTrust: ImageTrustTier;
  /** The SEP-58 `bldimg` value from the on-chain WASM, if declared. */
  bldimg?: string;
  /**
   * Set when the source was submitted as a content-addressed tarball
   * (SEP-58 `tarball_sha256` commitment model).
   */
  sourceMode?: "tarball";
  /** The verified tarball digest — only set once the digest gate passed. */
  tarballSha256?: string;
  detail: string;
}

export interface VerifyByIdOptions {
  contractId: string;
  /** Path to the locally rebuilt .wasm to compare against the chain. */
  rebuiltWasmPath: string;
  network?: string;
  /** Build-image allowlist; defaults to the checked-in docker/allowlist.json. */
  allowlist?: AllowlistEntry[];
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
  const allowlist = opts.allowlist ?? (await loadAllowlist());

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
      // No on-chain bytes means no bldimg metadata to judge.
      imageTrust: "unknown",
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
    allowlist,
  });
}

/** The chain-fetch boundary verifyTarballById depends on (ChainReader satisfies it). */
export interface OnChainWasmSource {
  fetchWasmByContractId(
    contractId: string,
  ): Promise<{ wasm: Uint8Array; sha256: string }>;
}

export interface VerifyTarballByIdOptions {
  contractId: string;
  /** Path to the source tarball (.tar.gz). */
  tarballPath: string;
  /** Expected SHA-256 of the tarball file (hex) — the SEP-58 tarball_sha256 commitment. */
  tarballSha256: string;
  network?: string;
  /** Build-image allowlist; defaults to the checked-in docker/allowlist.json. */
  allowlist?: AllowlistEntry[];
  /** Builds the unpacked source tree and returns the path of the built .wasm. */
  build: (sourceDir: string) => Promise<string>;
  /** On-chain WASM source; defaults to a ChainReader for `network`. */
  reader?: OnChainWasmSource;
}

/**
 * Verify a deployed contract from a content-addressed source tarball:
 * gate on the tarball's SHA-256, unpack, rebuild, and compare against the
 * on-chain WASM. The digest check runs FIRST — a tarball that does not match
 * its commitment is never unpacked or built.
 */
export async function verifyTarballById(
  opts: VerifyTarballByIdOptions,
): Promise<VerificationResult> {
  const network = opts.network ?? "testnet";
  // No on-chain bytes were fetched on these paths, so there is no bldimg
  // metadata to judge — hence imageTrust "unknown".
  const error = (
    detail: string,
    tarballSha256?: string,
  ): VerificationResult => ({
    verdict: "ERROR",
    contractId: opts.contractId,
    network,
    match: false,
    imageTrust: "unknown",
    sourceMode: "tarball",
    tarballSha256,
    detail,
  });

  const tarball = new Uint8Array(await readFile(opts.tarballPath));
  const actualSha256 = sha256Hex(tarball);
  if (!hashesEqual(actualSha256, opts.tarballSha256)) {
    return error(
      `Tarball digest mismatch: expected ${normalizeHashHex(opts.tarballSha256)}, ` +
        `got ${actualSha256}. Refusing to unpack or build an unverified tarball.`,
    );
  }
  const verifiedSha256 = normalizeHashHex(opts.tarballSha256);

  let sourceDir: string;
  try {
    sourceDir = await unpackTarball(opts.tarballPath);
  } catch (err) {
    return error(
      `Failed to unpack tarball: ${(err as Error).message}`,
      verifiedSha256,
    );
  }
  try {
    const wasmPath = await opts.build(sourceDir);
    const rebuiltBytes = new Uint8Array(await readFile(wasmPath));
    const rebuiltSha256 = sha256Hex(rebuiltBytes);
    const allowlist = opts.allowlist ?? (await loadAllowlist());
    const reader = opts.reader ?? new ChainReader(network);
    const onChain = await reader.fetchWasmByContractId(opts.contractId);
    return {
      ...compareWasm({
        contractId: opts.contractId,
        network,
        onChainBytes: onChain.wasm,
        onChainSha256: onChain.sha256,
        rebuiltBytes,
        rebuiltSha256,
        allowlist,
      }),
      sourceMode: "tarball",
      tarballSha256: verifiedSha256,
    };
  } catch (err) {
    return error(
      `Failed to rebuild and compare from tarball: ${(err as Error).message}`,
      verifiedSha256,
    );
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
  }
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
  /** Build-image allowlist; omit for an empty allowlist (no trusted images). */
  allowlist?: AllowlistEntry[];
}): VerificationResult {
  const {
    contractId,
    network,
    onChainBytes,
    onChainSha256,
    rebuiltBytes,
    rebuiltSha256,
    allowlist = [],
  } = args;

  // Image trust is judged on the ON-CHAIN metadata: the deployed artifact is
  // what declares which image built it.
  const onChainMeta = extractContractMetaSection(onChainBytes);
  const bldimg = onChainMeta.sep58.bldimg;

  const base = {
    contractId,
    network,
    onChainSha256: normalizeHashHex(onChainSha256),
    rebuiltSha256: normalizeHashHex(rebuiltSha256),
    onChainByteLength: onChainBytes.byteLength,
    rebuiltByteLength: rebuiltBytes.byteLength,
    imageTrust: deriveImageTrust(bldimg, allowlist),
    bldimg,
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
  const onChainStripped = onChainMeta.stripped;
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
