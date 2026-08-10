import { describe, expect, it } from "vitest";
import { Beacon, RoundExpiredError } from "./beacon.js";
import { InMemoryRoundStore } from "./store-memory.js";
import { commitmentHashFor } from "./entropy.js";

describe("Beacon.commitRound", () => {
  it("publishes only the hash, never the seed", async () => {
    const store = new InMemoryRoundStore();
    const beacon = new Beacon(store);

    const commitment = await beacon.commitRound({ gameId: "coin-flip", currentLedger: 100 });

    expect(commitment).not.toHaveProperty("serverSeed");
    expect(commitment.commitHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores a server seed that hashes to the published commitHash", async () => {
    const store = new InMemoryRoundStore();
    const beacon = new Beacon(store);

    const commitment = await beacon.commitRound({ gameId: "coin-flip", currentLedger: 100 });
    const stored = await store.getCommitment(commitment.roundId);

    expect(commitmentHashFor(stored!.serverSeed)).toBe(commitment.commitHash);
  });

  it("sets an expiry ledger ahead of the commit ledger", async () => {
    const store = new InMemoryRoundStore();
    const beacon = new Beacon(store);

    const commitment = await beacon.commitRound({ gameId: "coin-flip", currentLedger: 100, validForLedgers: 50 });
    expect(commitment.expiresAtLedger).toBe(150);
  });

  it("records a round.committed audit entry", async () => {
    const store = new InMemoryRoundStore();
    const beacon = new Beacon(store);

    await beacon.commitRound({ gameId: "coin-flip", currentLedger: 100 });
    const audit = await store.listAudit();

    expect(audit).toHaveLength(1);
    expect(audit[0]?.event).toBe("round.committed");
  });
});

describe("Beacon.assertNotExpired", () => {
  it("returns the commitment when still valid", async () => {
    const store = new InMemoryRoundStore();
    const beacon = new Beacon(store);
    const commitment = await beacon.commitRound({ gameId: "coin-flip", currentLedger: 100, validForLedgers: 10 });

    const record = await beacon.assertNotExpired(commitment.roundId, 105);
    expect(record.roundId).toBe(commitment.roundId);
  });

  it("throws RoundExpiredError past the expiry ledger", async () => {
    const store = new InMemoryRoundStore();
    const beacon = new Beacon(store);
    const commitment = await beacon.commitRound({ gameId: "coin-flip", currentLedger: 100, validForLedgers: 10 });

    await expect(beacon.assertNotExpired(commitment.roundId, 200)).rejects.toBeInstanceOf(RoundExpiredError);
  });

  it("throws for an unknown round", async () => {
    const store = new InMemoryRoundStore();
    const beacon = new Beacon(store);
    await expect(beacon.assertNotExpired("missing", 100)).rejects.toThrow(/No commitment found/);
  });
});
