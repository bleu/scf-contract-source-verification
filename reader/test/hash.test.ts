import { describe, it, expect } from "vitest";
import { sha256Hex, normalizeHashHex, hashesEqual } from "../src/hash.js";

describe("sha256Hex", () => {
  it("matches the known SHA-256 of an empty input", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the known SHA-256 of 'abc'", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is stable across repeated calls (determinism)", () => {
    const data = new TextEncoder().encode("soroscan");
    expect(sha256Hex(data)).toBe(sha256Hex(data));
  });
});

describe("normalizeHashHex / hashesEqual", () => {
  it("strips 0x, lowercases, trims", () => {
    expect(normalizeHashHex("  0xABCDEF  ")).toBe("abcdef");
  });

  it("treats differently-cased / 0x-prefixed hashes as equal", () => {
    expect(hashesEqual("0xABC123", "abc123")).toBe(true);
  });

  it("treats genuinely different hashes as unequal", () => {
    expect(hashesEqual("abc", "abd")).toBe(false);
  });
});
