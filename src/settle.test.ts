import { describe, expect, it } from "vitest";
import { Beacon, RoundExpiredError } from "./beacon.js";
import { CircuitBreaker, PolicyViolationError } from "./policy.js";
import { Settler } from "./settle.js";
import { InMemoryRoundStore } from "./store-memory.js";

async function committedRound(store: InMemoryRoundStore, gameId = "coin-flip") {
  const beacon = new Beacon(store);
  return beacon.commitRound({ gameId, currentLedger: 100, validForLedgers: 100 });
}

describe("Settler.settle", () => {
  it("derives an outcome and pays out on a win", async () => {
    const store = new InMemoryRoundStore();
    const commitment = await committedRound(store);
    const settler = new Settler(store, 5000_0000000n);

    // Try both sides; one of them must win since coin-flip is binary.
    const stored = await store.getCommitment(commitment.roundId);
    const heads = await settler.settle({
      roundId: commitment.roundId,
      stake: 10_0000000n,
      clientSeed: "client",
      nonce: 1,
      ledgerHash: "ledger-1",
      choice: { side: "heads" },
      currentLedger: 105,
    });

    expect(stored).not.toBeNull();
    expect(["heads", "tails"]).toContain((heads.outcome as { side: string }).side);
  });

  it("is idempotent — settling twice returns the same result and only audits once", async () => {
    const store = new InMemoryRoundStore();
    const commitment = await committedRound(store);
    const settler = new Settler(store, 5000_0000000n);

    const input = {
      roundId: commitment.roundId,
      stake: 10_0000000n,
      clientSeed: "client",
      nonce: 1,
      ledgerHash: "ledger-1",
      choice: { side: "heads" },
      currentLedger: 105,
    };

    const first = await settler.settle(input);
    const second = await settler.settle(input);

    expect(first.wasFirstSettlement).toBe(true);
    expect(second.wasFirstSettlement).toBe(false);
    expect(second.outcome).toEqual(first.outcome);
    expect(second.payout).toBe(first.payout);

    const audit = await store.listAudit();
    expect(audit.filter((e) => e.event === "round.settled")).toHaveLength(1);
  });

  it("handles a settlement race — only one caller wins, both get the same result", async () => {
    const store = new InMemoryRoundStore();
    const commitment = await committedRound(store);
    const settler = new Settler(store, 5000_0000000n);

    const input = {
      roundId: commitment.roundId,
      stake: 10_0000000n,
      clientSeed: "client",
      nonce: 1,
      ledgerHash: "ledger-1",
      choice: { side: "heads" },
      currentLedger: 105,
    };

    const [a, b, c] = await Promise.all([settler.settle(input), settler.settle(input), settler.settle(input)]);

    const firstCount = [a, b, c].filter((r) => r.wasFirstSettlement).length;
    expect(firstCount).toBe(1);
    expect(a.payout).toBe(b.payout);
    expect(b.payout).toBe(c.payout);
  });

  it("rejects settlement past the round expiry", async () => {
    const store = new InMemoryRoundStore();
    const commitment = await committedRound(store);
    const settler = new Settler(store, 5000_0000000n);

    await expect(
      settler.settle({
        roundId: commitment.roundId,
        stake: 10_0000000n,
        clientSeed: "client",
        nonce: 1,
        ledgerHash: "ledger",
        choice: { side: "heads" },
        currentLedger: 999,
      }),
    ).rejects.toBeInstanceOf(RoundExpiredError);
  });

  it("rejects a stake outside policy limits", async () => {
    const store = new InMemoryRoundStore();
    const commitment = await committedRound(store);
    const settler = new Settler(store, 5000_0000000n);

    await expect(
      settler.settle({
        roundId: commitment.roundId,
        stake: 0n,
        clientSeed: "client",
        nonce: 1,
        ledgerHash: "ledger",
        choice: { side: "heads" },
        currentLedger: 105,
      }),
    ).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it("refuses to settle while the circuit breaker is open", async () => {
    const store = new InMemoryRoundStore();
    const commitment = await committedRound(store);
    const breaker = new CircuitBreaker();
    breaker.trip("test");
    const settler = new Settler(store, 5000_0000000n, breaker);

    await expect(
      settler.settle({
        roundId: commitment.roundId,
        stake: 10_0000000n,
        clientSeed: "client",
        nonce: 1,
        ledgerHash: "ledger",
        choice: { side: "heads" },
        currentLedger: 105,
      }),
    ).rejects.toBeInstanceOf(PolicyViolationError);
  });
});
