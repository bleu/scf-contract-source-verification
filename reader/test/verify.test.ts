import { describe, it, expect } from "vitest";
import { compareWasm } from "../src/verify.js";
import { sha256Hex } from "../src/hash.js";

/** Minimal valid WASM module with a "core" custom section + a contractmetav0 section. */
function moduleWithMeta(metaPayload: string, body: number[]): Uint8Array {
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  const coreName = [...new TextEncoder().encode("core")];
  const coreBody = [coreName.length, ...coreName, ...body];
  const coreSec = [0x00, coreBody.length, ...coreBody];

  const metaName = [...new TextEncoder().encode("contractmetav0")];
  const metaBytes = [...new TextEncoder().encode(metaPayload)];
  const metaBody = [metaName.length, ...metaName, ...metaBytes];
  const metaSec = [0x00, metaBody.length, ...metaBody];

  return Uint8Array.from([...header, ...coreSec, ...metaSec]);
}

describe("compareWasm verdicts", () => {
  it("FULL_MATCH when bytes are identical", () => {
    const bytes = moduleWithMeta("rsver=1.91.1", [1, 2, 3, 4]);
    const r = compareWasm({
      network: "testnet",
      contractId: "C".padEnd(56, "A"),
      onChainBytes: bytes,
      onChainSha256: sha256Hex(bytes),
      rebuiltBytes: bytes,
      rebuiltSha256: sha256Hex(bytes),
    });
    expect(r.verdict).toBe("FULL_MATCH");
    expect(r.match).toBe(true);
  });

  it("METADATA_ONLY_MATCH when only contractmetav0 differs", () => {
    const onChain = moduleWithMeta("rsver=1.91.1", [1, 2, 3, 4]);
    const rebuilt = moduleWithMeta("rsver=1.99.9-different", [1, 2, 3, 4]);
    const r = compareWasm({
      network: "testnet",
      onChainBytes: onChain,
      onChainSha256: sha256Hex(onChain),
      rebuiltBytes: rebuilt,
      rebuiltSha256: sha256Hex(rebuilt),
    });
    expect(r.verdict).toBe("METADATA_ONLY_MATCH");
    expect(r.match).toBe(false);
  });

  it("NO_MATCH when the bytecode body differs", () => {
    const onChain = moduleWithMeta("rsver=1.91.1", [1, 2, 3, 4]);
    const rebuilt = moduleWithMeta("rsver=1.91.1", [9, 9, 9, 9]);
    const r = compareWasm({
      network: "testnet",
      onChainBytes: onChain,
      onChainSha256: sha256Hex(onChain),
      rebuiltBytes: rebuilt,
      rebuiltSha256: sha256Hex(rebuilt),
    });
    expect(r.verdict).toBe("NO_MATCH");
    expect(r.match).toBe(false);
  });
});
