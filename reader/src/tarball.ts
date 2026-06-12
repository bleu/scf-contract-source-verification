/**
 * Safe unpacking of content-addressed source tarballs (SEP-58 tarball_sha256
 * submission model). The digest gate lives in verify.ts; this module only
 * deals with getting a verified tarball onto disk without letting the archive
 * write outside its extraction directory.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

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

async function listEntryNames(tarballPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileP("tar", ["-tzf", tarballPath]);
    return stdout.split("\n").filter((line) => line.length > 0);
  } catch (err) {
    throw new TarballError(
      `malformed archive (not a readable .tar.gz): ${(err as Error).message}`,
    );
  }
}

/**
 * Unpack a .tar.gz into a fresh temporary directory and return that directory.
 * Every entry name is validated against path traversal before any byte is
 * extracted. The caller owns cleanup of the returned directory (fs.rm
 * recursive).
 */
export async function unpackTarball(tarballPath: string): Promise<string> {
  const names = await listEntryNames(tarballPath);
  for (const name of names) assertSafeEntryName(name);
  const dir = await mkdtemp(join(tmpdir(), "soroscan-verify-src-"));
  try {
    await execFileP("tar", ["-xzf", tarballPath, "-C", dir]);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw new TarballError(
      `failed to extract archive: ${(err as Error).message}`,
    );
  }
  return dir;
}
