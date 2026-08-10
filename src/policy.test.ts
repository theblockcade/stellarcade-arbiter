import { describe, expect, it } from "vitest";
import { CircuitBreaker, PolicyViolationError, assertPayoutAllowed, assertStakeAllowed, limitsFor } from "./policy.js";

describe("assertStakeAllowed", () => {
  it("allows a stake within bounds", () => {
    expect(() => assertStakeAllowed("coin-flip", 10_0000000n)).not.toThrow();
  });

  it("rejects a stake below the minimum", () => {
    expect(() => assertStakeAllowed("coin-flip", 0n)).toThrow(PolicyViolationError);
  });

  it("rejects a stake above the maximum", () => {
    expect(() => assertStakeAllowed("coin-flip", 1_000_0000000n)).toThrow(PolicyViolationError);
  });

  it("uses per-game overrides when present", () => {
    const limits = limitsFor("trivia");
    expect(limits.maxStake).toBe(100_0000000n);
  });
});

describe("assertPayoutAllowed", () => {
  it("allows a payout within the per-game multiplier and global cap", () => {
    expect(() => assertPayoutAllowed("coin-flip", 10_0000000n, 15_0000000n, 5000_0000000n)).not.toThrow();
  });

  it("rejects a payout exceeding the per-game multiplier", () => {
    expect(() => assertPayoutAllowed("coin-flip", 10_0000000n, 10000_0000000n, 50000_0000000n)).toThrow(
      /stake cap/,
    );
  });

  it("rejects a payout exceeding the global max even under the multiplier", () => {
    expect(() => assertPayoutAllowed("number-guess", 100_0000000n, 9000_0000000n, 5000_0000000n)).toThrow(
      /global max/,
    );
  });
});

describe("CircuitBreaker", () => {
  it("is closed by default", () => {
    const breaker = new CircuitBreaker();
    expect(breaker.isOpen()).toBe(false);
    expect(() => breaker.assertClosed()).not.toThrow();
  });

  it("throws once tripped", () => {
    const breaker = new CircuitBreaker();
    breaker.trip("anomalous payout rate");
    expect(breaker.isOpen()).toBe(true);
    expect(() => breaker.assertClosed()).toThrow(/anomalous payout rate/);
  });

  it("closes again after reset", () => {
    const breaker = new CircuitBreaker();
    breaker.trip("test");
    breaker.reset();
    expect(() => breaker.assertClosed()).not.toThrow();
  });
});
