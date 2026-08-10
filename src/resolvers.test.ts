import { describe, expect, it } from "vitest";
import { resolverFor } from "./resolvers.js";

describe("coin-flip resolver", () => {
  const resolve = resolverFor("coin-flip");

  it("pays 2x stake when the call matches the derived side", () => {
    // derivedValue % 2 === 0 -> "heads"
    const result = resolve(0n, 100n, { side: "heads" });
    expect(result.outcome).toMatchObject({ side: "heads", won: true });
    expect(result.payout).toBe(200n);
  });

  it("pays nothing when the call misses", () => {
    const result = resolve(0n, 100n, { side: "tails" });
    expect(result.outcome).toMatchObject({ side: "heads", won: false });
    expect(result.payout).toBe(0n);
  });

  it("pays nothing for a malformed choice", () => {
    const result = resolve(1n, 100n, { side: "sideways" });
    expect(result.payout).toBe(0n);
  });
});

describe("dice-roll resolver", () => {
  const resolve = resolverFor("dice-roll");

  it("maps derived value to a 1-6 roll and pays 6x on a hit", () => {
    // 6n % 6n === 0 -> roll 1
    const result = resolve(6n, 50n, { number: 1 });
    expect(result.outcome).toMatchObject({ roll: 1, won: true });
    expect(result.payout).toBe(300n);
  });

  it("pays nothing on a miss", () => {
    const result = resolve(6n, 50n, { number: 6 });
    expect(result.payout).toBe(0n);
  });
});

describe("resolverFor", () => {
  it("throws for an unregistered game", () => {
    expect(() => resolverFor("does-not-exist")).toThrow(/No resolver registered/);
  });
});
