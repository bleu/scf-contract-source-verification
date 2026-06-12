import { describe, it, expect } from "vitest";
import { ChainReader } from "../src/chain-reader.js";
import { extractContractMetaSection } from "../src/contractmeta.js";
import { deriveImageTrust, loadAllowlist } from "../src/image-trust.js";

/**
 * Live testnet integration test. Opt-in: only runs when SOROSCAN_INTEGRATION=1
 * (it requires network access to soroban-testnet.stellar.org).
 *
 * Fixture: the hello-soroban contract deployed from this repo.
 *   contract ID: CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB
 *   wasm hash:   6fe7bd58e5a33dc27daefc74acfae6eb70f101fdbde860475cf18fde87288e4b
 */
const RUN = process.env.SOROSCAN_INTEGRATION === "1";
const CONTRACT_ID =
  "CDVSGPL3HFBGJ6ZEYQUAVE3OH3XE2ZE5ZT2GWPA3LKOYVD4UBPQJ2VHB";
const EXPECTED_HASH =
  "6fe7bd58e5a33dc27daefc74acfae6eb70f101fdbde860475cf18fde87288e4b";

describe.skipIf(!RUN)("live testnet chain read", () => {
  it("fetches on-chain WASM and computes the expected SHA-256", async () => {
    const reader = new ChainReader("testnet");
    const res = await reader.fetchWasmByContractId(CONTRACT_ID);
    expect(res.sha256).toBe(EXPECTED_HASH);
    expect(res.byteLength).toBeGreaterThan(0);
  }, 30_000);

  it("fetches the same WASM by hash", async () => {
    const reader = new ChainReader("testnet");
    const res = await reader.fetchWasmByHash(EXPECTED_HASH);
    expect(res.sha256).toBe(EXPECTED_HASH);
  }, 30_000);

  it("derives an image-trust tier from the fixture's on-chain metadata", async () => {
    const reader = new ChainReader("testnet");
    const res = await reader.fetchWasmByContractId(CONTRACT_ID);
    const meta = extractContractMetaSection(res.wasm);
    const tier = deriveImageTrust(meta.sep58.bldimg, await loadAllowlist());
    // The fixture predates SEP-58 bldimg stamping, so no bldimg → "unknown"
    // is the correct signal, not a failure.
    if (meta.sep58.bldimg === undefined) {
      expect(tier).toBe("unknown");
    } else {
      expect(["sdf-trusted", "publicly-auditable", "arbitrary"]).toContain(
        tier,
      );
    }
  }, 30_000);
});
