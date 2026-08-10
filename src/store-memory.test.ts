import { describe, expect, it } from "vitest";
import { InMemoryRoundStore } from "./store-memory.js";
import { RoundNotFoundError } from "./store.js";

function commitment(roundId: string) {
  return {
    roundId,
    gameId: "coin-flip",
    serverSeed: "seed",
    commitHash: "hash",
    committedAtLedger: 1,
    expiresAtLedger: 100,
    status: "committed" as const,
  };
}

function settlement(roundId: string) {
  return {
    roundId,
    clientSeed: "client",
    nonce: 1,
    ledgerHash: "ledger",
    derivedValue: "deadbeef",
    outcome: "heads",
    payout: "10",
    settledAtLedger: 50,
  };
}

describe("InMemoryRoundStore", () => {
  it("stores and retrieves a commitment", async () => {
    const store = new InMemoryRoundStore();
    await store.insertCommitment(commitment("r1"));
    const found = await store.getCommitment("r1");
    expect(found?.roundId).toBe("r1");
  });

  it("returns null for an unknown round", async () => {
    const store = new InMemoryRoundStore();
    expect(await store.getCommitment("missing")).toBeNull();
  });

  it("marks a round revealed", async () => {
    const store = new InMemoryRoundStore();
    await store.insertCommitment(commitment("r1"));
    await store.markRevealed("r1");
    const found = await store.getCommitment("r1");
    expect(found?.status).toBe("revealed");
  });

  it("throws RoundNotFoundError marking an unknown round revealed", async () => {
    const store = new InMemoryRoundStore();
    await expect(store.markRevealed("missing")).rejects.toBeInstanceOf(RoundNotFoundError);
  });

  it("settles a round exactly once — concurrent settlement is rejected", async () => {
    const store = new InMemoryRoundStore();
    await store.insertCommitment(commitment("r1"));

    const results = await Promise.all([
      store.insertSettlementIfAbsent(settlement("r1")),
      store.insertSettlementIfAbsent(settlement("r1")),
      store.insertSettlementIfAbsent(settlement("r1")),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const found = await store.getCommitment("r1");
    expect(found?.status).toBe("settled");
  });

  it("chains audit entries with a running hash", async () => {
    const store = new InMemoryRoundStore();
    const a = await store.appendAudit("round.committed", { roundId: "r1" });
    const b = await store.appendAudit("round.settled", { roundId: "r1" });

    expect(a.prevHash).toBe("0".repeat(64));
    expect(b.prevHash).toBe(a.hash);
    expect(a.hash).not.toBe(b.hash);
  });

  it("lists audit entries after a given sequence", async () => {
    const store = new InMemoryRoundStore();
    await store.appendAudit("e1", {});
    await store.appendAudit("e2", {});
    await store.appendAudit("e3", {});

    const entries = await store.listAudit(1);
    expect(entries.map((e) => e.event)).toEqual(["e2", "e3"]);
  });
});
