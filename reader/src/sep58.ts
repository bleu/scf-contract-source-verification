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
 * SEP-58 layers six well-known keys on top of those entries (`bldimg`,
 * `bldopt`, `source_repo`, `source_rev`, `tarball_url`, `tarball_sha256`) and
 * defines how a verifier should locate the source from them — the "source
 * mode" below.
 */

/** One decoded SEP-46 SCMetaV0 key/value record. */
export interface ScMetaEntry {
  key: string;
  val: string;
}

/**
 * How (if at all) the contract's metadata commits to its source:
 *
 *  - public-repo:       `source_repo` + `source_rev` — source is a public VCS
 *                       checkout at a pinned revision.
 *  - hosted-tarball:    `tarball_url` + `tarball_sha256` — source is a hosted
 *                       archive pinned by digest.
 *  - content-addressed: `tarball_sha256` alone — private source committed by
 *                       digest only; the verifier must be handed the archive
 *                       out of band.
 *  - none:              no SEP-58 source identifiers found.
 */
export type SourceMode =
  | "public-repo"
  | "hosted-tarball"
  | "content-addressed"
  | "none";

/** The six SEP-58 metadata fields (absent keys are left undefined). */
export interface Sep58Fields {
  /** Build image digest/reference (`bldimg`). */
  bldimg?: string;
  /** Build options/flags (`bldopt`). */
  bldopt?: string;
  /** Public source repository, e.g. `github:org/repo` (`source_repo`). */
  sourceRepo?: string;
  /** Pinned revision (commit hash/tag) in that repo (`source_rev`). */
  sourceRev?: string;
  /** URL of a hosted source tarball (`tarball_url`). */
  tarballUrl?: string;
  /** SHA-256 digest of the source tarball (`tarball_sha256`). */
  tarballSha256?: string;
}

const SEP58_KEYS: Record<string, keyof Sep58Fields> = {
  bldimg: "bldimg",
  bldopt: "bldopt",
  source_repo: "sourceRepo",
  source_rev: "sourceRev",
  tarball_url: "tarballUrl",
  tarball_sha256: "tarballSha256",
};

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
 * Pick the SEP-58 fields out of decoded meta entries. If a key repeats, the
 * last occurrence wins (matching how tooling appends entries to the section).
 */
export function extractSep58Fields(entries: ScMetaEntry[]): Sep58Fields {
  const fields: Sep58Fields = {};
  for (const { key, val } of entries) {
    const prop = SEP58_KEYS[key];
    if (prop !== undefined) fields[prop] = val;
  }
  return fields;
}

/**
 * Infer the SEP-58 source mode from the extracted fields. Modes are checked in
 * order of preference — a contract publishing both a repo pin and a tarball
 * digest reports `public-repo`. A field without its required partner (e.g.
 * `source_repo` without `source_rev`) does not qualify its mode.
 */
export function inferSourceMode(fields: Sep58Fields): SourceMode {
  if (fields.sourceRepo && fields.sourceRev) return "public-repo";
  if (fields.tarballUrl && fields.tarballSha256) return "hosted-tarball";
  if (fields.tarballSha256) return "content-addressed";
  return "none";
}
