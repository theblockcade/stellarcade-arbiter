import { describe, expect, it } from "vitest";
import { Beacon } from "./beacon.js";
import { commitmentHashFor } from "./entropy.js";
import { ProofArchive, ProofNotAvailableError } from "./proofs.js";
import { Settler } from "./settle.js";
import { InMemoryRoundStore } from "./store-memory.js";

describe("ProofArchive.getProof", () => {
  it("throws for an unknown round", async () => {
    const store = new InMemoryRoundStore();
    const archive = new ProofArchive(store);
    await expect(archive.getProof("missing")).rejects.toBeInstanceOf(ProofNotAvailableError);
  });

  it("throws before the round is settled", async () => {
    const store = new InMemoryRoundStore();
    const beacon = new Beacon(store);
    const commitment = await beacon.commitRound({ gameId: "coin-flip", currentLedger: 1 });

    const archive = new ProofArchive(store);
    await expect(archive.getProof(commitment.roundId)).rejects.toThrow(/not settled yet/);
  });

  it("publishes a proof whose commitHash and derivedValue match the settled round", async () => {
    const store = new InMemoryRoundStore();
    const beacon = new Beacon(store);
    const settler = new Settler(store, 5000_0000000n);
    const commitment = await beacon.commitRound({ gameId: "coin-flip", currentLedger: 1, validForLedgers: 100 });

    const result = await settler.settle({
      roundId: commitment.roundId,
      stake: 10_0000000n,
      clientSeed: "client-seed",
      nonce: 3,
      ledgerHash: "ledger-hash",
      choice: { side: "heads" },
      currentLedger: 10,
    });

    const archive = new ProofArchive(store);
    const proof = await archive.getProof(commitment.roundId);

    expect(proof.commitHash).toBe(commitment.commitHash);
    expect(commitmentHashFor(proof.serverSeed)).toBe(proof.commitHash);
    expect(proof.derivedValue).toBe(result.derivedValue);
    expect(proof.clientSeed).toBe("client-seed");
    expect(proof.nonce).toBe(3);
  });
});
