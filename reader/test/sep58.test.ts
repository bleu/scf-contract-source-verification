import { describe, it, expect } from "vitest";
import {
  decodeContractMetaEntries,
  extractSep58Fields,
  inferSourceMode,
  type Sep58Fields,
} from "../src/sep58.js";
import { extractContractMetaSection } from "../src/contractmeta.js";

/** XDR u32 (big-endian). */
function u32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

/** XDR string: u32 length + bytes, zero-padded to a 4-byte boundary. */
function xdrString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const padded = (bytes.length + 3) & ~3;
  const out = new Uint8Array(4 + padded);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let w = 0;
  for (const p of parts) {
    out.set(p, w);
    w += p.length;
  }
  return out;
}

/** One XDR SCMetaEntry (kind SC_META_V0 = 0) with the given key/val. */
function metaEntry(key: string, val: string): Uint8Array {
  return concat([u32(0), xdrString(key), xdrString(val)]);
}

/** A contractmetav0 payload: concatenated SCMetaEntry stream. */
function metaPayload(pairs: Array<[string, string]>): Uint8Array {
  return concat(pairs.map(([k, v]) => metaEntry(k, v)));
}

/** Unsigned LEB128 encoding. */
function uleb128(n: number): Uint8Array {
  const bytes: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    bytes.push(b);
  } while (n !== 0);
  return Uint8Array.from(bytes);
}

/** Encode one contractmetav0 custom section for the given entries. */
function metaSection(pairs: Array<[string, string]>): Uint8Array {
  const payload = metaPayload(pairs);
  const name = new TextEncoder().encode("contractmetav0");
  const body = concat([uleb128(name.length), name, payload]);
  return concat([new Uint8Array([0x00]), uleb128(body.length), body]);
}

/** Build a minimal WASM module containing contractmetav0 custom section(s). */
function wasmWithMetaSections(
  sections: Array<Array<[string, string]>>,
): Uint8Array {
  return concat([
    new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    ...sections.map(metaSection),
  ]);
}

function wasmWithMeta(pairs: Array<[string, string]>): Uint8Array {
  return wasmWithMetaSections([pairs]);
}

describe("decodeContractMetaEntries", () => {
  it("decodes a stream of SCMetaV0 entries in order", () => {
    const raw = metaPayload([
      ["rsver", "1.91.1"],
      ["rssdkver", "25.3.1"],
    ]);
    expect(decodeContractMetaEntries(raw)).toEqual([
      { key: "rsver", val: "1.91.1" },
      { key: "rssdkver", val: "25.3.1" },
    ]);
  });

  it("handles strings whose lengths are not multiples of 4 (XDR padding)", () => {
    const raw = metaPayload([["k", "abcde"]]);
    expect(decodeContractMetaEntries(raw)).toEqual([
      { key: "k", val: "abcde" },
    ]);
  });

  it("returns [] for an empty payload", () => {
    expect(decodeContractMetaEntries(new Uint8Array(0))).toEqual([]);
  });

  it("returns the decoded prefix when the stream is truncated", () => {
    const good = metaEntry("rsver", "1.91.1");
    const truncated = concat([good, u32(0), u32(99)]); // entry then a cut-off string
    expect(decodeContractMetaEntries(truncated)).toEqual([
      { key: "rsver", val: "1.91.1" },
    ]);
  });

  it("stops at an unknown SCMetaKind without throwing", () => {
    const raw = concat([
      metaEntry("rsver", "1.91.1"),
      u32(7), // unknown kind — unknown layout, cannot skip
      xdrString("x"),
    ]);
    expect(decodeContractMetaEntries(raw)).toEqual([
      { key: "rsver", val: "1.91.1" },
    ]);
  });

  it("returns [] for non-XDR garbage", () => {
    const raw = new TextEncoder().encode("rsver=1.91.1");
    expect(decodeContractMetaEntries(raw)).toEqual([]);
  });

  it("rejects a hostile string length near UINT32_MAX (32-bit padding overflow)", () => {
    // (0xfffffffe + 3) & ~3 wraps to 0 in 32-bit math; the decoder must not
    // accept it as a zero-padded string and emit a garbage entry.
    const raw = concat([u32(0), xdrString("k"), u32(0xfffffffe)]);
    expect(decodeContractMetaEntries(raw)).toEqual([]);
  });
});

describe("extractSep58Fields", () => {
  it("maps all six SEP-58 keys and ignores non-SEP-58 entries", () => {
    const entries = decodeContractMetaEntries(
      metaPayload([
        ["rsver", "1.91.1"],
        ["bldimg", "docker.io/stellar/stellar-cli@sha256:abc"],
        ["bldopt", "--locked"],
        ["source_repo", "github:org/repo"],
        ["source_rev", "deadbeef"],
        ["tarball_url", "https://example.com/src.tar.gz"],
        ["tarball_sha256", "ff".repeat(32)],
      ]),
    );
    expect(extractSep58Fields(entries)).toEqual({
      bldimg: "docker.io/stellar/stellar-cli@sha256:abc",
      bldopt: ["--locked"],
      sourceRepo: "github:org/repo",
      sourceRev: "deadbeef",
      tarballUrl: "https://example.com/src.tar.gz",
      tarballSha256: "ff".repeat(32),
    });
  });

  it("accumulates repeated bldopt entries in order (one flag per entry per SEP-58)", () => {
    const fields = extractSep58Fields([
      { key: "bldopt", val: "--manifest-path=contracts/foo/Cargo.toml" },
      { key: "bldopt", val: "--optimize" },
      { key: "bldopt", val: "--locked" },
    ]);
    expect(fields.bldopt).toEqual([
      "--manifest-path=contracts/foo/Cargo.toml",
      "--optimize",
      "--locked",
    ]);
  });

  it("last occurrence wins for duplicate keys", () => {
    const fields = extractSep58Fields([
      { key: "source_rev", val: "old" },
      { key: "source_rev", val: "new" },
    ]);
    expect(fields.sourceRev).toBe("new");
  });

  it("does not resolve keys through Object.prototype", () => {
    const fields = extractSep58Fields([
      { key: "constructor", val: "evil" },
      { key: "toString", val: "evil" },
      { key: "__proto__", val: "evil" },
    ]);
    expect(fields).toEqual({});
  });
});

describe("inferSourceMode", () => {
  const cases: Array<[string, Sep58Fields, string]> = [
    [
      "public-repo when source_repo + source_rev",
      { sourceRepo: "github:org/repo", sourceRev: "abc" },
      "public-repo",
    ],
    [
      "hosted-tarball when tarball_url + tarball_sha256",
      { tarballUrl: "https://x/src.tgz", tarballSha256: "aa".repeat(32) },
      "hosted-tarball",
    ],
    [
      "content-addressed when tarball_sha256 alone",
      { tarballSha256: "aa".repeat(32) },
      "content-addressed",
    ],
    ["none when no SEP-58 source identifiers", {}, "none"],
    [
      "none when only build fields are present",
      { bldimg: "img", bldopt: "--locked" },
      "none",
    ],
    [
      "source_repo without source_rev does not qualify as public-repo",
      { sourceRepo: "github:org/repo" },
      "none",
    ],
    [
      "source_rev alone does not qualify",
      { sourceRev: "abc" },
      "none",
    ],
    [
      "tarball_url alone is hosted-tarball-unpinned (SEP-58 §2 third combination)",
      { tarballUrl: "https://x/src.tgz" },
      "hosted-tarball-unpinned",
    ],
    [
      "tarball_url alone with an incomplete repo pin is still hosted-tarball-unpinned",
      { sourceRepo: "github:org/repo", tarballUrl: "https://x/src.tgz" },
      "hosted-tarball-unpinned",
    ],
    [
      "repo pin wins over tarball pin when both are complete",
      {
        sourceRepo: "github:org/repo",
        sourceRev: "abc",
        tarballUrl: "https://x/src.tgz",
        tarballSha256: "aa".repeat(32),
      },
      "public-repo",
    ],
    [
      "incomplete repo pin falls through to content-addressed",
      { sourceRepo: "github:org/repo", tarballSha256: "aa".repeat(32) },
      "content-addressed",
    ],
  ];

  for (const [name, fields, expected] of cases) {
    it(name, () => {
      expect(inferSourceMode(fields)).toBe(expected);
    });
  }
});

describe("extractContractMetaSection SEP-58 surface (synthetic modules)", () => {
  it("public-repo module", () => {
    const r = extractContractMetaSection(
      wasmWithMeta([
        ["source_repo", "github:org/repo"],
        ["source_rev", "deadbeef"],
      ]),
    );
    expect(r.found).toBe(true);
    expect(r.sep58.sourceRepo).toBe("github:org/repo");
    expect(r.sep58.sourceRev).toBe("deadbeef");
    expect(r.sourceMode).toBe("public-repo");
  });

  it("hosted-tarball module", () => {
    const r = extractContractMetaSection(
      wasmWithMeta([
        ["tarball_url", "https://x/s.tgz"],
        ["tarball_sha256", "aa".repeat(32)],
      ]),
    );
    expect(r.sourceMode).toBe("hosted-tarball");
  });

  it("content-addressed module", () => {
    const r = extractContractMetaSection(
      wasmWithMeta([["tarball_sha256", "aa".repeat(32)]]),
    );
    expect(r.sourceMode).toBe("content-addressed");
  });

  it("hosted-tarball-unpinned module", () => {
    const r = extractContractMetaSection(
      wasmWithMeta([["tarball_url", "https://x/s.tgz"]]),
    );
    expect(r.sourceMode).toBe("hosted-tarball-unpinned");
  });

  it("module with only SEP-46 entries reports mode none", () => {
    const r = extractContractMetaSection(wasmWithMeta([["rsver", "1.91.1"]]));
    expect(r.found).toBe(true);
    expect(r.entries).toEqual([{ key: "rsver", val: "1.91.1" }]);
    expect(r.sep58).toEqual({});
    expect(r.sourceMode).toBe("none");
  });

  it("decodes entries from ALL contractmetav0 sections (soroban-sdk + stellar CLI emit separate ones)", () => {
    const r = extractContractMetaSection(
      wasmWithMetaSections([
        [
          ["rsver", "1.91.1"],
          ["rssdkver", "25.3.1"],
        ],
        [
          ["source_repo", "github:org/repo"],
          ["source_rev", "deadbeef"],
        ],
      ]),
    );
    expect(r.entries.map((e) => e.key)).toEqual([
      "rsver",
      "rssdkver",
      "source_repo",
      "source_rev",
    ]);
    expect(r.sourceMode).toBe("public-repo");
    // both sections are stripped
    expect(r.stripped.length).toBe(8);
  });

  it("module with no contractmetav0 section reports mode none", () => {
    const header = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ]);
    const r = extractContractMetaSection(header);
    expect(r.found).toBe(false);
    expect(r.entries).toEqual([]);
    expect(r.sourceMode).toBe("none");
  });
});
