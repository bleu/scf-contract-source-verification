#!/usr/bin/env node
import { argv, exit, stdout, stderr } from "node:process";
import { ChainReader } from "./chain-reader.js";
import { verifyById, type VerificationResult } from "./verify.js";

const USAGE = `soroscan-verify — Soroban contract source verification (TESTNET ONLY, MVP)

Usage:
  soroscan-verify read   --id <CONTRACT_ID> [--network testnet] [--json]
  soroscan-verify verify --id <CONTRACT_ID> --wasm <path/to/rebuilt.wasm> [--network testnet] [--json]

Commands:
  read    Fetch the on-chain WASM for a contract ID and print its SHA-256.
  verify  Rebuild-compare: assert the locally rebuilt WASM's SHA-256 matches
          the on-chain ContractCodeEntry hash. Exit 0 only on FULL_MATCH.

Examples:
  soroscan-verify read   --id CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB
  soroscan-verify verify --id CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB \\
                         --wasm contracts/target/wasm32v1-none/release/hello_soroban.wasm
`;

interface Flags {
  id?: string;
  wasm?: string;
  network: string;
  json: boolean;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { network: "testnet", json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--id":
        flags.id = args[++i];
        break;
      case "--wasm":
        flags.wasm = args[++i];
        break;
      case "--network":
        flags.network = args[++i];
        break;
      case "--json":
        flags.json = true;
        break;
      default:
        throw new Error(`Unknown flag: ${a}`);
    }
  }
  return flags;
}

function printVerdict(r: VerificationResult, asJson: boolean): void {
  if (asJson) {
    stdout.write(JSON.stringify(r, null, 2) + "\n");
    return;
  }
  const icon =
    r.verdict === "FULL_MATCH"
      ? "[OK]"
      : r.verdict === "METADATA_ONLY_MATCH"
        ? "[~]"
        : r.verdict === "NO_MATCH"
          ? "[X]"
          : "[!]";
  stdout.write(`\n${icon}  ${r.verdict}\n`);
  stdout.write(`    contract:  ${r.contractId ?? "(n/a)"}\n`);
  stdout.write(`    network:   ${r.network}\n`);
  stdout.write(`    on-chain:  ${r.onChainSha256 ?? "(not fetched)"}\n`);
  stdout.write(`    rebuilt:   ${r.rebuiltSha256}\n`);
  if (r.onChainByteLength !== undefined) {
    stdout.write(
      `    bytes:     on-chain=${r.onChainByteLength} rebuilt=${r.rebuiltByteLength}\n`,
    );
  }
  stdout.write(`    ${r.detail}\n\n`);
}

async function main(): Promise<number> {
  const args = argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    stdout.write(USAGE);
    return cmd ? 0 : 1;
  }

  const flags = parseFlags(args.slice(1));

  if (cmd === "read") {
    if (!flags.id) throw new Error("read requires --id <CONTRACT_ID>");
    const reader = new ChainReader(flags.network);
    const res = await reader.fetchWasmByContractId(flags.id);
    if (flags.json) {
      stdout.write(
        JSON.stringify(
          {
            contractId: res.contractId,
            network: res.network,
            sha256: res.sha256,
            byteLength: res.byteLength,
          },
          null,
          2,
        ) + "\n",
      );
    } else {
      stdout.write(`\ncontract:  ${res.contractId}\n`);
      stdout.write(`network:   ${res.network}\n`);
      stdout.write(`sha256:    ${res.sha256}\n`);
      stdout.write(`bytes:     ${res.byteLength}\n\n`);
    }
    return 0;
  }

  if (cmd === "verify") {
    if (!flags.id) throw new Error("verify requires --id <CONTRACT_ID>");
    if (!flags.wasm) throw new Error("verify requires --wasm <path>");
    const result = await verifyById({
      contractId: flags.id,
      rebuiltWasmPath: flags.wasm,
      network: flags.network,
    });
    printVerdict(result, flags.json);
    return result.verdict === "FULL_MATCH" ? 0 : 1;
  }

  stdout.write(`Unknown command: ${cmd}\n\n${USAGE}`);
  return 1;
}

main()
  .then((code) => exit(code))
  .catch((err) => {
    stderr.write(`\nError: ${(err as Error).message}\n`);
    exit(2);
  });
