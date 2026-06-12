import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  deriveImageTrust,
  loadAllowlist,
  type AllowlistEntry,
} from "../src/image-trust.js";
import { compareWasm } from "../src/verify.js";
import { sha256Hex } from "../src/hash.js";

const SDF_DIGEST = "sha256:" + "ab".repeat(32);

const ALLOWLIST: AllowlistEntry[] = [
  {
    image: "docker.io/stellar/stellar-cli:23.0.0",
    digest: SDF_DIGEST,
    tier: "sdf-trusted",
    source: "test fixture",
  },
  {
    image: "soroscan-verify-builder:rust-1.91.1-cli-26.1.0",
    digest: null,
    tier: "publicly-auditable",
    source: "test fixture",
  },
];

describe("deriveImageTrust", () => {
  it("sdf-trusted when the bldimg digest is on the allowlist", () => {
    expect(
      deriveImageTrust(`docker.io/stellar/stellar-cli@${SDF_DIGEST}`, ALLOWLIST),
    ).toBe("sdf-trusted");
  });

  it("matches by digest even when the reference part differs", () => {
    expect(
      deriveImageTrust(`some-mirror.example/cli@${SDF_DIGEST}`, ALLOWLIST),
    ).toBe("sdf-trusted");
  });

  it("publicly-auditable when the full reference matches a digest-less entry", () => {
    expect(
      deriveImageTrust("soroscan-verify-builder:rust-1.91.1-cli-26.1.0", ALLOWLIST),
    ).toBe("publicly-auditable");
  });

  it("arbitrary when a bldimg is declared but not allowlisted", () => {
    expect(
      deriveImageTrust("docker.io/evil/builder@sha256:" + "ee".repeat(32), ALLOWLIST),
    ).toBe("arbitrary");
  });

  it("unknown when no bldimg metadata is available", () => {
    expect(deriveImageTrust(undefined, ALLOWLIST)).toBe("unknown");
    expect(deriveImageTrust("", ALLOWLIST)).toBe("unknown");
  });

  it("does not match a digest-less bldimg against an entry's digest", () => {
    // "no digest declared" must not equal "digest: null" by accident
    expect(
      deriveImageTrust("docker.io/stellar/stellar-cli:23.0.0-other", ALLOWLIST),
    ).toBe("arbitrary");
  });
});

describe("loadAllowlist", () => {
  it("loads the checked-in docker/allowlist.json with the pinned toolchain image", async () => {
    const entries = await loadAllowlist();
    const toolchain = entries.find(
      (e) => e.image === "soroscan-verify-builder:rust-1.91.1-cli-26.1.0",
    );
    expect(toolchain).toBeDefined();
    expect(toolchain!.tier).toBe("publicly-auditable");
    expect(toolchain!.source).toBeTruthy();
  });

  it("returns an empty allowlist for a missing file", async () => {
    expect(await loadAllowlist("/nonexistent/allowlist.json")).toEqual([]);
  });

  it("rejects an entry granting a non-allowlistable tier", async () => {
    const dir = await mkdtemp(join(tmpdir(), "soroscan-allowlist-"));
    const path = join(dir, "allowlist.json");
    try {
      await writeFile(
        path,
        JSON.stringify({
          entries: [
            { image: "x:1", digest: null, tier: "arbitrary", source: "s" },
          ],
        }),
      );
      await expect(loadAllowlist(path)).rejects.toThrow(/invalid tier/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// --- compareWasm carries the tier through the verification result ----------

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

/** Minimal WASM module with a contractmetav0 section of SCMetaV0 entries. */
function wasmWithMeta(pairs: Array<[string, string]>): Uint8Array {
  const payload = concat(
    pairs.map(([k, v]) => concat([u32(0), xdrString(k), xdrString(v)])),
  );
  const name = new TextEncoder().encode("contractmetav0");
  const body = concat([uleb128(name.length), name, payload]);
  return concat([
    new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    new Uint8Array([0x00]),
    uleb128(body.length),
    body,
  ]);
}

function compareSelf(bytes: Uint8Array, allowlist?: AllowlistEntry[]) {
  return compareWasm({
    network: "testnet",
    onChainBytes: bytes,
    onChainSha256: sha256Hex(bytes),
    rebuiltBytes: bytes,
    rebuiltSha256: sha256Hex(bytes),
    allowlist,
  });
}

describe("compareWasm imageTrust", () => {
  it("FULL_MATCH with an sdf-trusted bldimg digest", () => {
    const bldimg = `docker.io/stellar/stellar-cli@${SDF_DIGEST}`;
    const r = compareSelf(wasmWithMeta([["bldimg", bldimg]]), ALLOWLIST);
    expect(r.verdict).toBe("FULL_MATCH");
    expect(r.imageTrust).toBe("sdf-trusted");
    expect(r.bldimg).toBe(bldimg);
  });

  it("FULL_MATCH with a publicly-auditable allowlisted image", () => {
    const r = compareSelf(
      wasmWithMeta([["bldimg", "soroscan-verify-builder:rust-1.91.1-cli-26.1.0"]]),
      ALLOWLIST,
    );
    expect(r.verdict).toBe("FULL_MATCH");
    expect(r.imageTrust).toBe("publicly-auditable");
  });

  it("declared-but-unlisted bldimg is arbitrary, even on FULL_MATCH", () => {
    const r = compareSelf(
      wasmWithMeta([["bldimg", "docker.io/evil/builder:latest"]]),
      ALLOWLIST,
    );
    expect(r.verdict).toBe("FULL_MATCH");
    expect(r.imageTrust).toBe("arbitrary");
  });

  it("no bldimg metadata is unknown", () => {
    const r = compareSelf(wasmWithMeta([["rsver", "1.91.1"]]), ALLOWLIST);
    expect(r.verdict).toBe("FULL_MATCH");
    expect(r.imageTrust).toBe("unknown");
    expect(r.bldimg).toBeUndefined();
  });

  it("judges trust on the ON-CHAIN metadata, not the rebuilt WASM's", () => {
    const onChain = wasmWithMeta([
      ["bldimg", `docker.io/stellar/stellar-cli@${SDF_DIGEST}`],
    ]);
    const rebuilt = wasmWithMeta([["bldimg", "docker.io/evil/builder:latest"]]);
    const r = compareWasm({
      network: "testnet",
      onChainBytes: onChain,
      onChainSha256: sha256Hex(onChain),
      rebuiltBytes: rebuilt,
      rebuiltSha256: sha256Hex(rebuilt),
      allowlist: ALLOWLIST,
    });
    expect(r.verdict).toBe("METADATA_ONLY_MATCH");
    expect(r.imageTrust).toBe("sdf-trusted");
  });

  it("defaults to an empty allowlist: declared image is arbitrary", () => {
    const r = compareSelf(
      wasmWithMeta([["bldimg", "soroscan-verify-builder:rust-1.91.1-cli-26.1.0"]]),
    );
    expect(r.imageTrust).toBe("arbitrary");
  });
});
