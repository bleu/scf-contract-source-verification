import { describe, it, expect, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { verifyTarballById } from "../src/verify.js";
import { sha256Hex } from "../src/hash.js";

const execFileP = promisify(execFile);

const CONTRACT_ID = "C".padEnd(56, "A");

/** Minimal valid (header-only) WASM module — enough for compareWasm to parse. */
const WASM_BYTES = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0]);

const CONTRACTS_DIR = fileURLToPath(
  new URL("../../contracts", import.meta.url),
);

async function writeTempFile(name: string, bytes: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "soroscan-tarball-test-"));
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

/** Tarball of the repo's sample-contract source (the verify.sh build inputs). */
async function makeSampleContractTarball(): Promise<{
  path: string;
  sha256: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "soroscan-tarball-fixture-"));
  const path = join(dir, "hello-soroban-src.tar.gz");
  await execFileP("tar", [
    "-czf",
    path,
    "-C",
    CONTRACTS_DIR,
    "Cargo.toml",
    "Cargo.lock",
    "hello-soroban",
  ]);
  return { path, sha256: sha256Hex(new Uint8Array(await readFile(path))) };
}

/**
 * Hand-rolled .tar.gz with attacker-controlled entry names (the tar CLI
 * refuses to *create* such archives, so build the ustar blocks directly).
 */
function makeTarGz(entries: Array<{ name: string; content: string }>): Uint8Array {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const { name, content } of entries) {
    const data = enc.encode(content);
    const header = new Uint8Array(512);
    header.set(enc.encode(name), 0);
    header.set(enc.encode("0000644\0"), 100); // mode
    header.set(enc.encode("0000000\0"), 108); // uid
    header.set(enc.encode("0000000\0"), 116); // gid
    header.set(enc.encode(data.length.toString(8).padStart(11, "0") + "\0"), 124);
    header.set(enc.encode("00000000000\0"), 136); // mtime
    header.set(enc.encode("        "), 148); // checksum: spaces while summing
    header[156] = 0x30; // typeflag: regular file
    header.set(enc.encode("ustar\0"), 257);
    header.set(enc.encode("00"), 263);
    let sum = 0;
    for (const b of header) sum += b;
    header.set(enc.encode(sum.toString(8).padStart(6, "0") + "\0 "), 148);
    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024)); // end-of-archive marker
  const tar = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let off = 0;
  for (const b of blocks) {
    tar.set(b, off);
    off += b.length;
  }
  return new Uint8Array(gzipSync(tar));
}

/** A fake on-chain source serving WASM_BYTES, as if deployed from the fixture. */
function stubReader() {
  return {
    fetchWasmByContractId: vi
      .fn()
      .mockResolvedValue({ wasm: WASM_BYTES, sha256: sha256Hex(WASM_BYTES) }),
  };
}

describe("verifyTarballById", () => {
  it("ERROR on digest mismatch, without unpacking or building", async () => {
    const tarballPath = await writeTempFile(
      "src.tar.gz",
      new TextEncoder().encode("definitely not the expected bytes"),
    );
    const build = vi.fn();
    const reader = { fetchWasmByContractId: vi.fn() };

    const r = await verifyTarballById({
      contractId: CONTRACT_ID,
      network: "testnet",
      tarballPath,
      tarballSha256: "0".repeat(64),
      build,
      reader,
    });

    expect(r.verdict).toBe("ERROR");
    expect(r.match).toBe(false);
    expect(r.sourceMode).toBe("tarball");
    expect(r.detail).toMatch(/digest mismatch/i);
    // The digest check is the integrity gate: nothing downstream may run.
    expect(build).not.toHaveBeenCalled();
    expect(reader.fetchWasmByContractId).not.toHaveBeenCalled();
  });

  it("matching digest: unpacks, rebuilds, and reports the verdict plus the tarball digest", async () => {
    const fixture = await makeSampleContractTarball();
    const reader = stubReader();
    // Observed at build time — the unpacked tree is cleaned up after verify.
    const seen: Array<{ dir: string; hasManifest: boolean; hasLib: boolean }> =
      [];
    const build = vi.fn(async (sourceDir: string) => {
      seen.push({
        dir: sourceDir,
        hasManifest: existsSync(join(sourceDir, "Cargo.toml")),
        hasLib: existsSync(join(sourceDir, "hello-soroban", "src", "lib.rs")),
      });
      const wasmPath = join(sourceDir, "rebuilt.wasm");
      await writeFile(wasmPath, WASM_BYTES);
      return wasmPath;
    });

    const r = await verifyTarballById({
      contractId: CONTRACT_ID,
      network: "testnet",
      tarballPath: fixture.path,
      tarballSha256: fixture.sha256,
      build,
      reader,
    });

    expect(r.verdict).toBe("FULL_MATCH");
    expect(r.match).toBe(true);
    expect(r.sourceMode).toBe("tarball");
    expect(r.tarballSha256).toBe(fixture.sha256);
    expect(r.rebuiltSha256).toBe(sha256Hex(WASM_BYTES));
    expect(r.onChainSha256).toBe(sha256Hex(WASM_BYTES));

    // The build ran against a fresh unpacked copy of the source, not the
    // tarball's own directory.
    expect(build).toHaveBeenCalledTimes(1);
    expect(seen[0].dir).not.toBe(CONTRACTS_DIR);
    expect(seen[0].hasManifest).toBe(true);
    expect(seen[0].hasLib).toBe(true);
  });

  it("rejects archive entries with `..` path components without building", async () => {
    const bytes = makeTarGz([
      { name: "ok.txt", content: "fine" },
      { name: "../evil.txt", content: "escape attempt" },
    ]);
    const tarballPath = await writeTempFile("traversal.tar.gz", bytes);
    const build = vi.fn();

    const r = await verifyTarballById({
      contractId: CONTRACT_ID,
      network: "testnet",
      tarballPath,
      tarballSha256: sha256Hex(bytes),
      build,
      reader: stubReader(),
    });

    expect(r.verdict).toBe("ERROR");
    expect(r.match).toBe(false);
    expect(r.sourceMode).toBe("tarball");
    expect(r.detail).toMatch(/\.\./);
    expect(build).not.toHaveBeenCalled();
  });

  it("rejects archive entries with absolute paths without building", async () => {
    const bytes = makeTarGz([
      { name: "/etc/evil.txt", content: "absolute escape attempt" },
    ]);
    const tarballPath = await writeTempFile("absolute.tar.gz", bytes);
    const build = vi.fn();

    const r = await verifyTarballById({
      contractId: CONTRACT_ID,
      network: "testnet",
      tarballPath,
      tarballSha256: sha256Hex(bytes),
      build,
      reader: stubReader(),
    });

    expect(r.verdict).toBe("ERROR");
    expect(r.sourceMode).toBe("tarball");
    expect(r.detail).toMatch(/absolute/i);
    expect(build).not.toHaveBeenCalled();
  });

  it("ERROR on a malformed archive whose digest matches", async () => {
    const bytes = new TextEncoder().encode("this is not a tar.gz at all");
    const tarballPath = await writeTempFile("malformed.tar.gz", bytes);
    const build = vi.fn();

    const r = await verifyTarballById({
      contractId: CONTRACT_ID,
      network: "testnet",
      tarballPath,
      tarballSha256: sha256Hex(bytes),
      build,
      reader: stubReader(),
    });

    expect(r.verdict).toBe("ERROR");
    expect(r.match).toBe(false);
    expect(r.sourceMode).toBe("tarball");
    expect(r.detail).toMatch(/malformed/i);
    expect(build).not.toHaveBeenCalled();
  });

  it("ERROR (not a crash) when the build fails", async () => {
    const fixture = await makeSampleContractTarball();
    const build = vi.fn().mockRejectedValue(new Error("cargo exploded"));

    const r = await verifyTarballById({
      contractId: CONTRACT_ID,
      network: "testnet",
      tarballPath: fixture.path,
      tarballSha256: fixture.sha256,
      build,
      reader: stubReader(),
    });

    expect(r.verdict).toBe("ERROR");
    expect(r.sourceMode).toBe("tarball");
    expect(r.tarballSha256).toBe(fixture.sha256);
    expect(r.detail).toMatch(/cargo exploded/);
  });
});
