/**
 * Network configuration. TESTNET ONLY for this MVP.
 *
 * Mainnet config is intentionally NOT wired up. Adding mainnet here is a
 * deliberate, reviewed step (roadmap phase 2; see docs/ARCHITECTURE.md).
 */
export interface NetworkConfig {
  name: string;
  rpcUrl: string;
  /** SEP-11 network passphrase, used by the SDK for tx/identity scoping. */
  passphrase: string;
}

export const TESTNET: NetworkConfig = {
  name: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  passphrase: "Test SDF Network ; September 2015",
};

/**
 * Resolve a network by name. Only `testnet` is supported in the MVP.
 * Anything else throws — we never silently fall through to mainnet.
 */
export function resolveNetwork(name: string): NetworkConfig {
  if (name === "testnet") return TESTNET;
  throw new Error(
    `Unsupported network "${name}". This MVP is TESTNET ONLY. ` +
      `Mainnet is gated to a later, reviewed milestone.`,
  );
}
