/**
 * Minimal WASM custom-section reader for the SEP-46 `contractmetav0` section.
 *
 * SEP-46 (Contract Meta) stores serialized `SCMetaEntry`/`SCMetaV0` key-value
 * records in a WASM **custom section** named `contractmetav0`. soroban-sdk
 * auto-injects keys such as `rsver` (rustc version) and `rssdkver` (Soroban SDK
 * version); tooling adds `source_repo=github:org/repo`.
 *
 * The WASM binary format (https://webassembly.github.io/spec/core/binary):
 *   - 8-byte module header: magic `\0asm` + version u32.
 *   - then a sequence of sections: 1-byte section id + u32 LEB128 size + body.
 *   - a CUSTOM section has id 0; its body is: name (vec of bytes, LEB length-
 *     prefixed) followed by the raw payload.
 *
 * The parser does three things:
 *   1. locate/return the raw `contractmetav0` section bytes (if any),
 *   2. return a copy of the module with that section removed, so the verifier
 *      can detect a "metadata-only" difference structurally, and
 *   3. decode the section's XDR SCMetaEntry records and surface the SEP-58
 *      source metadata fields + inferred source mode (see sep58.ts).
 */

import {
  decodeContractMetaEntries,
  extractSep58Fields,
  inferSourceMode,
  type ScMetaEntry,
  type Sep58Fields,
  type SourceMode,
} from "./sep58.js";

const CONTRACT_META_SECTION = "contractmetav0";

export interface ContractMetaResult {
  /** True if a `contractmetav0` custom section was found. */
  found: boolean;
  /**
   * Raw payload bytes, concatenated in module order when multiple
   * `contractmetav0` sections are present (empty if not found). The wasm spec
   * allows repeated custom sections with the same name, and Soroban tooling
   * uses that: soroban-sdk emits one section and `stellar contract build`
   * appends another (e.g. `cliver`).
   */
  raw: Uint8Array;
  /** The module with all `contractmetav0` sections removed. */
  stripped: Uint8Array;
  /** Decoded SEP-46 SCMetaV0 key/value entries (empty if none decoded). */
  entries: ScMetaEntry[];
  /** SEP-58 fields found among the entries. */
  sep58: Sep58Fields;
  /** SEP-58 source mode inferred from the fields ("none" if not committed). */
  sourceMode: SourceMode;
}

function readUleb128(
  buf: Uint8Array,
  offset: number,
): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= buf.length) throw new Error("LEB128 overran buffer");
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new Error("LEB128 too long");
  }
  return { value: result >>> 0, next: pos };
}

/**
 * Parse a WASM module, locate the `contractmetav0` custom section, and return
 * its raw payload plus a stripped copy of the module.
 *
 * If the input is not a valid WASM module (e.g. truncated), returns
 * found=false with `stripped` equal to the original bytes — callers treat a
 * non-parse as "no metadata section to strip".
 */
export function extractContractMetaSection(
  wasm: Uint8Array,
): ContractMetaResult {
  const notFound: ContractMetaResult = {
    found: false,
    raw: new Uint8Array(0),
    stripped: wasm,
    entries: [],
    sep58: {},
    sourceMode: "none",
  };

  // Validate header: magic 0x00 0x61 0x73 0x6d, version 1.
  if (
    wasm.length < 8 ||
    wasm[0] !== 0x00 ||
    wasm[1] !== 0x61 ||
    wasm[2] !== 0x73 ||
    wasm[3] !== 0x6d
  ) {
    return notFound;
  }

  let pos = 8;
  const keep: Array<[number, number]> = []; // ranges to keep (start, end)
  const metaParts: Uint8Array[] = [];
  // Start at 0 so the 8-byte module header is preserved in the stripped output.
  let lastKept = 0;

  try {
    while (pos < wasm.length) {
      const sectionStart = pos;
      const sectionId = wasm[pos++];
      const { value: sectionSize, next } = readUleb128(wasm, pos);
      pos = next;
      const bodyStart = pos;
      const bodyEnd = bodyStart + sectionSize;
      if (bodyEnd > wasm.length) throw new Error("section overruns module");

      if (sectionId === 0) {
        // custom section: body = name (uleb len + bytes) + payload
        const { value: nameLen, next: afterLen } = readUleb128(wasm, bodyStart);
        const nameBytes = wasm.subarray(afterLen, afterLen + nameLen);
        const name = new TextDecoder().decode(nameBytes);
        if (name === CONTRACT_META_SECTION) {
          metaParts.push(wasm.slice(afterLen + nameLen, bodyEnd));
          // drop this section from the stripped output
          keep.push([lastKept, sectionStart]);
          lastKept = bodyEnd;
        }
      }
      pos = bodyEnd;
    }
  } catch {
    return notFound;
  }

  if (metaParts.length === 0) return notFound;

  keep.push([lastKept, wasm.length]);
  const total = keep.reduce((acc, [s, e]) => acc + (e - s), 0);
  const stripped = new Uint8Array(total);
  let w = 0;
  for (const [s, e] of keep) {
    stripped.set(wasm.subarray(s, e), w);
    w += e - s;
  }

  // Concatenate repeated sections: XDR SCMetaEntry streams compose cleanly.
  const metaRaw = new Uint8Array(
    metaParts.reduce((acc, p) => acc + p.length, 0),
  );
  let mw = 0;
  for (const p of metaParts) {
    metaRaw.set(p, mw);
    mw += p.length;
  }

  const entries = decodeContractMetaEntries(metaRaw);
  const sep58 = extractSep58Fields(entries);
  return {
    found: true,
    raw: metaRaw,
    stripped,
    entries,
    sep58,
    sourceMode: inferSourceMode(sep58),
  };
}
