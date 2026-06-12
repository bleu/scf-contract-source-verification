/**
 * SEP-58 source metadata: decode SEP-46 `SCMetaEntry` records and infer the
 * source mode a contract committed to.
 *
 * The `contractmetav0` custom section is a concatenated stream of XDR
 * `SCMetaEntry` values (https://stellar.org/protocol/sep-46):
 *
 *   union SCMetaEntry switch (SCMetaKind kind) {
 *     case SC_META_V0: SCMetaV0 v0;        // kind = 0
 *   };
 *   struct SCMetaV0 { string key<>; string val<>; };
 *
 * XDR primitives: u32 big-endian discriminant/lengths; strings are a u32 byte
 * length + bytes, zero-padded to a 4-byte boundary.
 *
 * SEP-58 (Contract Build Reproducibility for Verification, draft v0.3.0)
 * layers six well-known keys on top of those entries — build environment
 * (`bldimg`, `bldopt`) and source identification (`source_repo`,
 * `source_rev`, `tarball_url`, `tarball_sha256`) — and lists the conformant
 * source-identification combinations a verifier can use to locate the source.
 * We surface those combinations as the "source mode" below.
 */

/** One decoded SEP-46 SCMetaV0 key/value record. */
export interface ScMetaEntry {
  key: string;
  val: string;
}

/**
 * How (if at all) the contract's metadata commits to its source — one mode
 * per conformant combination in SEP-58 §2:
 *
 *  - public-repo:             `source_repo` + `source_rev` — source is a VCS
 *                             checkout at a pinned revision.
 *  - hosted-tarball:          `tarball_url` + `tarball_sha256` — source is a
 *                             hosted archive pinned by digest.
 *  - hosted-tarball-unpinned: `tarball_url` alone — verifier downloads and
 *                             extracts, trusting the host to keep serving the
 *                             same bytes (no digest pin).
 *  - content-addressed:       `tarball_sha256` alone — private source
 *                             committed by digest only; the verifier must be
 *                             handed the archive out of band.
 *  - none:                    no SEP-58 source identifiers found.
 */
export type SourceMode =
  | "public-repo"
  | "hosted-tarball"
  | "hosted-tarball-unpinned"
  | "content-addressed"
  | "none";

/** The six SEP-58 metadata fields (absent keys are left undefined). */
export interface Sep58Fields {
  /** Container build image pinned by digest (`bldimg`). */
  bldimg?: string;
  /**
   * Build flags (`bldopt`). Per SEP-58 §1 the entry MAY appear multiple
   * times, one flag per entry, order not significant — so this is a list.
   */
  bldopt?: string[];
  /**
   * Source repository (`source_repo`): HTTPS URL, or the SEP-55
   * `github:user/repo` shorthand.
   */
  sourceRepo?: string;
  /** Full SHA-1 of the source commit (`source_rev`). */
  sourceRev?: string;
  /** URL of a hosted source tarball (`tarball_url`). */
  tarballUrl?: string;
  /** SHA-256 digest of the source tarball (`tarball_sha256`). */
  tarballSha256?: string;
}

// Map, not a plain object: entry keys come from untrusted wasm, and a plain
// object lookup would hit Object.prototype for keys like "constructor".
// bldopt is handled separately because it accumulates instead of overwriting.
const SEP58_STRING_KEYS = new Map<
  string,
  Exclude<keyof Sep58Fields, "bldopt">
>([
  ["bldimg", "bldimg"],
  ["source_repo", "sourceRepo"],
  ["source_rev", "sourceRev"],
  ["tarball_url", "tarballUrl"],
  ["tarball_sha256", "tarballSha256"],
]);

/**
 * Decode the raw `contractmetav0` payload into SCMetaV0 entries.
 *
 * Tolerant by design: on a malformed/truncated stream (or an unknown
 * SCMetaKind, which has no known length and cannot be skipped) it returns the
 * entries decoded up to that point rather than throwing — a contract with
 * garbage metadata still reads, it just yields fewer entries.
 */
export function decodeContractMetaEntries(raw: Uint8Array): ScMetaEntry[] {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const decoder = new TextDecoder();
  const entries: ScMetaEntry[] = [];
  let pos = 0;

  const readString = (): string => {
    if (pos + 4 > raw.length) throw new Error("truncated XDR string length");
    const len = view.getUint32(pos);
    pos += 4;
    // Guard before the padding math: (len + 3) & ~3 wraps at 2^32, so a
    // hostile length near UINT32_MAX could otherwise pass the bounds check.
    if (len > raw.length - pos) throw new Error("truncated XDR string body");
    const padded = (len + 3) & ~3;
    if (pos + padded > raw.length) throw new Error("truncated XDR string body");
    const text = decoder.decode(raw.subarray(pos, pos + len));
    pos += padded;
    return text;
  };

  try {
    while (pos < raw.length) {
      if (pos + 4 > raw.length) throw new Error("truncated SCMetaEntry kind");
      const kind = view.getUint32(pos);
      pos += 4;
      if (kind !== 0) throw new Error(`unknown SCMetaKind ${kind}`);
      const key = readString();
      const val = readString();
      entries.push({ key, val });
    }
  } catch {
    // fall through with whatever decoded cleanly
  }
  return entries;
}

/**
 * Pick the SEP-58 fields out of decoded meta entries. `bldopt` accumulates
 * one flag per entry (repeatable per the spec); for the other keys, the last
 * occurrence wins (matching how tooling appends entries to the section).
 */
export function extractSep58Fields(entries: ScMetaEntry[]): Sep58Fields {
  const fields: Sep58Fields = {};
  for (const { key, val } of entries) {
    if (key === "bldopt") {
      (fields.bldopt ??= []).push(val);
      continue;
    }
    const prop = SEP58_STRING_KEYS.get(key);
    if (prop !== undefined) fields[prop] = val;
  }
  return fields;
}

/**
 * Infer the SEP-58 source mode from the extracted fields.
 *
 * SEP-58 §2 defines no precedence — a wasm MAY carry more than one conformant
 * combination and verifiers MAY support any subset — so the order here is this
 * verifier's preference, strongest commitment first: a contract publishing
 * both a repo pin and a tarball pin reports `public-repo` (the more auditable
 * channel), and a digest-pinned tarball outranks an unpinned URL. A required
 * partner being absent (e.g. `source_repo` without `source_rev`) disqualifies
 * the mode.
 */
export function inferSourceMode(fields: Sep58Fields): SourceMode {
  if (fields.sourceRepo && fields.sourceRev) return "public-repo";
  if (fields.tarballUrl && fields.tarballSha256) return "hosted-tarball";
  if (fields.tarballSha256) return "content-addressed";
  if (fields.tarballUrl) return "hosted-tarball-unpinned";
  return "none";
}
