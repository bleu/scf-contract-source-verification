/**
 * Image-trust signal: how trustworthy is the build image a contract declares
 * via the SEP-58 `bldimg` metadata key?
 *
 * This is a second trust dimension, orthogonal to the match verdict.
 * Reproducibility alone is not faithfulness to source: a hostile build image
 * can deterministically rewrite bytes and still pass byte-comparison. So the
 * verdict says whether the rebuild matched, and the image-trust tier says how
 * much the image that produced it can be trusted.
 *
 * Tiers are derived by looking the contract's `bldimg` up in a checked-in
 * allowlist (docker/allowlist.json). Eviction from the allowlist downgrades
 * the tier reported for past verifications; it never deletes verification
 * records.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 *  - sdf-trusted:        image digest is on the SDF-trusted allowlist
 *                        (official stellar-cli-docker releases).
 *  - publicly-auditable: image is allowlisted as a publicly-auditable
 *                        third-party image (e.g. this repo's pinned
 *                        toolchain image, built from a checked-in Dockerfile).
 *  - arbitrary:          a `bldimg` was declared but is not allowlisted.
 *  - unknown:            no `bldimg` metadata available.
 */
export type ImageTrustTier =
  | "sdf-trusted"
  | "publicly-auditable"
  | "arbitrary"
  | "unknown";

/** Tiers an allowlist entry may grant (the other two are derived, not granted). */
export type AllowlistedTier = Extract<
  ImageTrustTier,
  "sdf-trusted" | "publicly-auditable"
>;

export interface AllowlistEntry {
  /** Full image reference as it appears in `bldimg` (tag or digest form). */
  image: string;
  /** Registry digest (`sha256:<64-hex>`), or null while only built locally. */
  digest: string | null;
  tier: AllowlistedTier;
  /** Where the image/digest comes from and how to audit it. */
  source: string;
}

const ALLOWLISTED_TIERS: ReadonlySet<string> = new Set([
  "sdf-trusted",
  "publicly-auditable",
]);

/**
 * Derive the image-trust tier for a contract's `bldimg` value.
 *
 * A `bldimg` matches an entry when its `@sha256:` digest equals the entry's
 * digest (the strong identity), or when the full reference string equals the
 * entry's image (covers digest-less local tags). First matching entry wins.
 */
export function deriveImageTrust(
  bldimg: string | undefined,
  allowlist: AllowlistEntry[],
): ImageTrustTier {
  if (bldimg === undefined || bldimg === "") return "unknown";
  const at = bldimg.lastIndexOf("@");
  const digest = at >= 0 ? bldimg.slice(at + 1) : undefined;
  for (const entry of allowlist) {
    if (entry.digest !== null && entry.digest === digest) return entry.tier;
    if (entry.image === bldimg) return entry.tier;
  }
  return "arbitrary";
}

/** docker/allowlist.json, resolved from this module (src/ and dist/ are both one level under reader/). */
const DEFAULT_ALLOWLIST_PATH = fileURLToPath(
  new URL("../../docker/allowlist.json", import.meta.url),
);

/**
 * Load the build-image allowlist. A missing file is treated as an empty
 * allowlist (every declared image reports `arbitrary`); a malformed file or
 * an entry granting a non-allowlistable tier throws — the file is checked in,
 * so that is a bug to surface, not tolerate.
 */
export async function loadAllowlist(
  path: string = DEFAULT_ALLOWLIST_PATH,
): Promise<AllowlistEntry[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const parsed = JSON.parse(text) as { entries?: unknown };
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`Allowlist ${path} has no "entries" array`);
  }
  for (const entry of parsed.entries as AllowlistEntry[]) {
    if (typeof entry.image !== "string" || entry.image === "") {
      throw new Error(`Allowlist ${path}: entry missing "image"`);
    }
    if (entry.digest !== null && typeof entry.digest !== "string") {
      throw new Error(
        `Allowlist ${path}: entry "${entry.image}" digest must be a string or null`,
      );
    }
    if (!ALLOWLISTED_TIERS.has(entry.tier)) {
      throw new Error(
        `Allowlist ${path}: entry "${entry.image}" grants invalid tier "${entry.tier}"`,
      );
    }
  }
  return parsed.entries as AllowlistEntry[];
}
