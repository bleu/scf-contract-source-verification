import { describe, it, expect } from "vitest";
import { extractContractMetaSection } from "../src/contractmeta.js";

/** Build a minimal WASM module: header + optional custom sections. */
function wasmModule(sections: Uint8Array[]): Uint8Array {
  const header = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  ]);
  const total = header.length + sections.reduce((a, s) => a + s.length, 0);
  const out = new Uint8Array(total);
  out.set(header, 0);
  let w = header.length;
  for (const s of sections) {
    out.set(s, w);
    w += s.length;
  }
  return out;
}

/** Encode a custom section (id 0) with the given name + payload (names/bodies <128 bytes). */
function customSection(name: string, payload: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const body = new Uint8Array(1 + nameBytes.length + payload.length);
  body[0] = nameBytes.length;
  body.set(nameBytes, 1);
  body.set(payload, 1 + nameBytes.length);
  const section = new Uint8Array(2 + body.length);
  section[0] = 0x00;
  section[1] = body.length;
  section.set(body, 2);
  return section;
}

describe("extractContractMetaSection", () => {
  it("returns found=false for a module with no custom sections", () => {
    const mod = wasmModule([]);
    const r = extractContractMetaSection(mod);
    expect(r.found).toBe(false);
    expect(r.stripped).toBe(mod);
  });

  it("returns found=false for non-WASM input", () => {
    const r = extractContractMetaSection(new TextEncoder().encode("not wasm"));
    expect(r.found).toBe(false);
  });

  it("finds and strips the contractmetav0 section", () => {
    const meta = new TextEncoder().encode("rsver=1.91.1");
    const other = customSection("producers", new Uint8Array([1, 2, 3]));
    const metaSec = customSection("contractmetav0", meta);
    const mod = wasmModule([other, metaSec]);

    const r = extractContractMetaSection(mod);
    expect(r.found).toBe(true);
    expect(new TextDecoder().decode(r.raw)).toBe("rsver=1.91.1");
    expect(r.stripped.length).toBe(mod.length - metaSec.length);
  });

  it("two modules differing ONLY in contractmetav0 strip to identical bytes", () => {
    const body = customSection("data", new Uint8Array([9, 9, 9]));
    const modA = wasmModule([
      body,
      customSection("contractmetav0", new TextEncoder().encode("a=1")),
    ]);
    const modB = wasmModule([
      body,
      customSection("contractmetav0", new TextEncoder().encode("bbbb=2222")),
    ]);

    const a = extractContractMetaSection(modA).stripped;
    const b = extractContractMetaSection(modB).stripped;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
