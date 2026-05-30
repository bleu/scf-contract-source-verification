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
 * This parser does NOT decode the XDR SCMetaEntry payload — that is a
 * Testnet-tranche concern. For the MVP it does two things the verifier needs:
 *   1. locate/return the raw `contractmetav0` section bytes (if any), and
 *   2. return a copy of the module with that section removed, so the verifier
 *      can detect a "metadata-only" difference structurally.
 */

const CONTRACT_META_SECTION = "contractmetav0";

export interface ContractMetaResult {
  /** True if a `contractmetav0` custom section was found. */
  found: boolean;
  /** Raw payload bytes of the section (empty if not found). */
  raw: Uint8Array;
  /** The module with the `contractmetav0` section removed. */
  stripped: Uint8Array;
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
  let metaRaw: Uint8Array | null = null;
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
          metaRaw = wasm.slice(afterLen + nameLen, bodyEnd);
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

  if (metaRaw === null) return notFound;

  keep.push([lastKept, wasm.length]);
  const total = keep.reduce((acc, [s, e]) => acc + (e - s), 0);
  const stripped = new Uint8Array(total);
  let w = 0;
  for (const [s, e] of keep) {
    stripped.set(wasm.subarray(s, e), w);
    w += e - s;
  }

  return { found: true, raw: metaRaw, stripped };
}
