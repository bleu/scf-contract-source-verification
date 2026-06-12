/**
 * Safe unpacking of content-addressed source tarballs (SEP-58 tarball_sha256
 * submission model). The digest gate lives in verify.ts; this module only
 * deals with getting verified tarball BYTES onto disk without letting the
 * archive write outside its extraction directory.
 *
 * The caller passes the same in-memory buffer it hashed — the file on disk is
 * never re-read after the digest check, so there is no gap between what was
 * verified and what is extracted.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

/** Raised for anything wrong with the archive itself (malformed, unsafe entries). */
export class TarballError extends Error {}

/**
 * Reject entry names that could write outside the extraction directory:
 * absolute paths and any `..` path component.
 */
function assertSafeEntryName(name: string): void {
  if (name.startsWith("/")) {
    throw new TarballError(`unsafe archive entry (absolute path): ${name}`);
  }
  if (name.split("/").includes("..")) {
    throw new TarballError(`unsafe archive entry ('..' component): ${name}`);
  }
}

/** Gzip magic bytes (RFC 1952). Anything else is treated as a plain tar. */
function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function decompress(bytes: Uint8Array): Uint8Array {
  if (!isGzip(bytes)) return bytes;
  try {
    return new Uint8Array(gunzipSync(bytes));
  } catch (err) {
    return raiseMalformed(err);
  }
}

function raiseMalformed(err: unknown): never {
  throw new TarballError(
    `malformed archive (not a readable .tar / .tar.gz): ${(err as Error).message}`,
  );
}

const BLOCK = 512;

function field(block: Uint8Array, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return new TextDecoder().decode(end === -1 ? raw : raw.subarray(0, end));
}

/**
 * Walk the tar headers and reject link entries (typeflags "1" hardlink and
 * "2" symlink). Name validation alone cannot stop a symlink/hardlink whose
 * TARGET escapes the extraction dir, and relying on the host tar's default
 * protections makes behavior platform-dependent. Source archives do not need
 * links — cargo package enforces the same rule for crates.
 *
 * This is our own check on the verified bytes, independent of the tar binary.
 */
function assertNoLinkEntries(tar: Uint8Array): void {
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const block = tar.subarray(offset, offset + BLOCK);
    if (block.every((b) => b === 0)) return; // end-of-archive
    const typeflag = String.fromCharCode(block[156]);
    if (typeflag === "1" || typeflag === "2") {
      const kind = typeflag === "1" ? "hardlink" : "symlink";
      throw new TarballError(
        `unsafe archive entry (${kind} entries are not allowed in source tarballs): ` +
          `${field(block, 0, 100)} -> ${field(block, 157, 100)}`,
      );
    }
    const size = parseInt(field(block, 124, 12).trim() || "0", 8);
    if (Number.isNaN(size) || size < 0) {
      raiseMalformed(new Error("bad size field in tar header"));
    }
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
}

/** Run tar with `input` piped to stdin; resolve with stdout, reject on non-zero exit. */
function runTar(args: string[], input: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d));
    child.stderr.on("data", (d: Buffer) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `tar exited with ${code}`));
    });
    // tar may exit before consuming all input; ignore the resulting EPIPE.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/**
 * Unpack verified tarball bytes (.tar or .tar.gz) into a fresh temporary
 * directory and return that directory. Before any byte is extracted, link
 * entries are rejected and every entry name is validated against path
 * traversal. The caller owns cleanup of the returned directory (fs.rm
 * recursive).
 */
export async function unpackTarball(tarballBytes: Uint8Array): Promise<string> {
  const tar = decompress(tarballBytes);
  assertNoLinkEntries(tar);

  let listing: string;
  try {
    // -tf resolves pax/GNU long-name headers, so these are the effective names.
    listing = await runTar(["-tf", "-"], tar);
  } catch (err) {
    return raiseMalformed(err);
  }
  const names = listing.split("\n").filter((line) => line.length > 0);
  for (const name of names) assertSafeEntryName(name);

  const dir = await mkdtemp(join(tmpdir(), "soroscan-verify-src-"));
  try {
    await runTar(["-xf", "-", "-C", dir], tar);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw new TarballError(
      `failed to extract archive: ${(err as Error).message}`,
    );
  }
  return dir;
}
