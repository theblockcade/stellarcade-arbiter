import { describe, expect, it } from "vitest";
import { Beacon } from "./beacon.js";
import { replayRound } from "./dispute.js";
import { ProofArchive } from "./proofs.js";
import { Settler } from "./settle.js";
import { InMemoryRoundStore } from "./store-memory.js";

async function settledProof(gameId: string, choice: unknown) {
  const store = new InMemoryRoundStore();
  const beacon = new Beacon(store);
  const settler = new Settler(store, 5000_0000000n);
  const commitment = await beacon.commitRound({ gameId, currentLedger: 1, validForLedgers: 100 });

  await settler.settle({
    roundId: commitment.roundId,
    stake: 10_0000000n,
    clientSeed: "client-seed",
    nonce: 5,
    ledgerHash: "ledger-hash-42",
    choice,
    currentLedger: 10,
  });

  const archive = new ProofArchive(store);
  return archive.getProof(commitment.roundId);
}

describe("replayRound", () => {
  it("reproduces a real settled round end to end", async () => {
    const proof = await settledProof("dice-roll", { number: 3 });
    const result = replayRound(proof, 10_0000000n);

    expect(result.reproducible).toBe(true);
    expect(result.commitmentMatches).toBe(true);
    expect(result.derivedValueMatches).toBe(true);
    expect(result.outcomeMatches).toBe(true);
  });

  it("flags a proof with a tampered server seed", async () => {
    const proof = await settledProof("coin-flip", { side: "heads" });
    const tampered = { ...proof, serverSeed: "0".repeat(64) };

    const result = replayRound(tampered, 10_0000000n);
    expect(result.reproducible).toBe(false);
    expect(result.commitmentMatches).toBe(false);
    expect(result.reason).toMatch(/commitment/);
  });

  it("flags a proof with a tampered outcome", async () => {
    const proof = await settledProof("dice-roll", { number: 1 });
    const tampered = { ...proof, outcome: { roll: 999, won: false } };

    const result = replayRound(tampered, 10_0000000n);
    expect(result.reproducible).toBe(false);
    expect(result.outcomeMatches).toBe(false);
  });

  it("flags a proof with a tampered derivedValue", async () => {
    const proof = await settledProof("coin-flip", { side: "tails" });
    const tampered = { ...proof, derivedValue: "0".repeat(64) };

    const result = replayRound(tampered, 10_0000000n);
    expect(result.reproducible).toBe(false);
    expect(result.derivedValueMatches).toBe(false);
  });
});
