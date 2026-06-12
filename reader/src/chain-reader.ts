import { rpc } from "@stellar/stellar-sdk";
import { sha256Hex } from "./hash.js";
import { resolveNetwork, type NetworkConfig } from "./networks.js";

/**
 * Result of fetching a deployed contract's on-chain WASM.
 */
export interface OnChainWasm {
  /** The contract instance ID that was queried (C...). */
  contractId: string;
  /** The raw WASM bytecode stored in the referenced ContractCodeEntry. */
  wasm: Uint8Array;
  /**
   * SHA-256 (hex) of `wasm`, computed locally. This equals the WASM hash the
   * ledger uses as the ContractCodeEntry key.
   */
  sha256: string;
  /** Number of WASM bytes fetched. */
  byteLength: number;
  network: string;
}

/**
 * Chain reader: fetches the on-chain WASM for a deployed Soroban contract and
 * computes its SHA-256.
 *
 * Uses the `@stellar/stellar-sdk` `rpc.Server` API:
 *   - `getContractWasmByContractId(contractId)` resolves the instance's
 *     referenced WASM hash, then fetches the ContractCodeEntry bytecode.
 *   - `getContractWasmByHash(wasmHash)` fetches bytecode directly by hash
 *     (one hash can back many contract instances).
 *
 * (Both method names confirmed present on `rpc.Server.prototype` in the
 * installed SDK, v15.1.0.)
 */
export class ChainReader {
  private readonly server: rpc.Server;
  private readonly config: NetworkConfig;

  constructor(network: string | NetworkConfig = "testnet") {
    this.config =
      typeof network === "string" ? resolveNetwork(network) : network;
    // allowHttp false: testnet RPC is https.
    this.server = new rpc.Server(this.config.rpcUrl, { allowHttp: false });
  }

  /**
   * Fetch the on-chain WASM + SHA-256 for a deployed contract ID.
   * @throws if the contract ID is malformed, not found, or has no code entry.
   */
  async fetchWasmByContractId(contractId: string): Promise<OnChainWasm> {
    const id = contractId.trim();
    if (!/^C[A-Z2-7]{55}$/.test(id)) {
      throw new Error(
        `Malformed contract ID "${id}". Expected a 56-char StrKey starting with "C".`,
      );
    }

    const wasm = await this.server.getContractWasmByContractId(id);
    const bytes = toUint8Array(wasm);
    return {
      contractId: id,
      wasm: bytes,
      sha256: sha256Hex(bytes),
      byteLength: bytes.byteLength,
      network: this.config.name,
    };
  }

  /**
   * Fetch the on-chain WASM + SHA-256 directly by WASM hash (hex string or
   * Buffer). Useful because one verified hash covers every instance that
   * references it.
   */
  async fetchWasmByHash(
    wasmHash: string | Uint8Array,
  ): Promise<Omit<OnChainWasm, "contractId">> {
    if (typeof wasmHash === "string") {
      const hex = wasmHash.trim().replace(/^0x/, "");
      if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new Error(
          `Malformed wasm hash "${wasmHash}". Expected 64 hex chars (SHA-256).`,
        );
      }
    }
    const hashArg =
      typeof wasmHash === "string"
        ? Buffer.from(wasmHash.trim().replace(/^0x/, ""), "hex")
        : Buffer.from(wasmHash);
    const wasm = await this.server.getContractWasmByHash(hashArg);
    const bytes = toUint8Array(wasm);
    return {
      wasm: bytes,
      sha256: sha256Hex(bytes),
      byteLength: bytes.byteLength,
      network: this.config.name,
    };
  }
}

/** Coerce the SDK's returned bytes (Buffer/ArrayBuffer/Uint8Array) to Uint8Array. */
function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return Uint8Array.from(data as number[]);
  throw new Error(
    `Unexpected WASM payload type from RPC: ${Object.prototype.toString.call(data)}`,
  );
}
