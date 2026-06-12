/**
 * Default source builder for tarball-mode verification: rebuilds an unpacked
 * Soroban workspace with the same toolchain selection scripts/verify.sh
 * supports — the local pinned toolchain, or the pinned network-isolated
 * Docker image from docker/toolchain-manifest.json.
 */

import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLCHAIN_MANIFEST_PATH = fileURLToPath(
  new URL("../../docker/toolchain-manifest.json", import.meta.url),
);

interface ToolchainManifest {
  image: string;
  target: string;
}

/** Run a command with output streamed to the terminal; reject on non-zero exit. */
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`));
    });
  });
}

export interface ContractBuilderOptions {
  /** Build inside the pinned Docker image instead of the local toolchain. */
  docker?: boolean;
}

/**
 * Make a builder for verifyTarballById: builds the workspace at `sourceDir`
 * and returns the path of the single built .wasm.
 */
export function makeContractBuilder(
  opts: ContractBuilderOptions = {},
): (sourceDir: string) => Promise<string> {
  return async (sourceDir: string): Promise<string> => {
    const manifest = JSON.parse(
      await readFile(TOOLCHAIN_MANIFEST_PATH, "utf8"),
    ) as ToolchainManifest;

    if (opts.docker) {
      await run("docker", [
        "run",
        "--rm",
        "--network=none",
        "-v",
        `${sourceDir}:/work`,
        manifest.image,
      ]);
    } else {
      await run("stellar", ["contract", "build", "--locked"], {
        cwd: sourceDir,
      });
    }

    const releaseDir = join(sourceDir, "target", manifest.target, "release");
    const wasmFiles = (await readdir(releaseDir)).filter((f) =>
      f.endsWith(".wasm"),
    );
    if (wasmFiles.length !== 1) {
      throw new Error(
        `expected exactly one built .wasm in ${releaseDir}, found ${wasmFiles.length}`,
      );
    }
    return join(releaseDir, wasmFiles[0]);
  };
}
