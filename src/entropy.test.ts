import { describe, expect, it } from "vitest";
import { commitmentHashFor, deriveOutcomeValue, generateServerSeed, mapToRange, sha256Hex } from "./entropy.js";

describe("generateServerSeed", () => {
  it("generates 64 hex chars (32 bytes) of entropy", () => {
    const seed = generateServerSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a different seed each call", () => {
    const a = generateServerSeed();
    const b = generateServerSeed();
    expect(a).not.toBe(b);
  });
});

describe("commitmentHashFor", () => {
  it("matches sha256Hex of the seed", () => {
    const seed = "abc123";
    expect(commitmentHashFor(seed)).toBe(sha256Hex(seed));
  });

  it("is deterministic", () => {
    expect(commitmentHashFor("seed")).toBe(commitmentHashFor("seed"));
  });
});

describe("deriveOutcomeValue", () => {
  it("is deterministic for identical input", () => {
    const input = { serverSeed: "s", clientSeed: "c", nonce: 1, ledgerHash: "l" };
    expect(deriveOutcomeValue(input)).toBe(deriveOutcomeValue(input));
  });

  it("changes when the ledger hash changes", () => {
    const base = { serverSeed: "s", clientSeed: "c", nonce: 1, ledgerHash: "l1" };
    const other = { ...base, ledgerHash: "l2" };
    expect(deriveOutcomeValue(base)).not.toBe(deriveOutcomeValue(other));
  });
});

describe("mapToRange", () => {
  it("stays within [0, size)", () => {
    for (const v of [0n, 1n, 999999999999999999999999999999n]) {
      const mapped = mapToRange(v, 6);
      expect(mapped).toBeGreaterThanOrEqual(0);
      expect(mapped).toBeLessThan(6);
    }
  });

  it("throws for size <= 0", () => {
    expect(() => mapToRange(1n, 0)).toThrow(RangeError);
  });
});
