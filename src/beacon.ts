import { randomUUID } from "node:crypto";
import { commitmentHashFor, generateServerSeed } from "./entropy.js";
import type { CommitmentRecord, RoundStore } from "./store.js";

export class RoundExpiredError extends Error {
  constructor(roundId: string) {
    super(`Round "${roundId}" has expired and cannot be settled`);
    this.name = "RoundExpiredError";
  }
}

export interface CommitRoundInput {
  gameId: string;
  currentLedger: number;
  /** How many ledgers the commitment stays valid for before it expires unsettled. Default 200 (~15 min at 5s/ledger). */
  validForLedgers?: number;
}

export interface PublicCommitment {
  roundId: string;
  gameId: string;
  commitHash: string;
  committedAtLedger: number;
  expiresAtLedger: number;
}

/**
 * Owns the "commit before bet" half of the fairness scheme. `commitRound`
 * generates a fresh server seed and publishes only its hash — the seed
 * itself stays in the store, inaccessible via any public method here, until
 * settle.ts reveals it as part of settlement.
 */
export class Beacon {
  constructor(private readonly store: RoundStore) {}

  async commitRound(input: CommitRoundInput): Promise<PublicCommitment> {
    const roundId = randomUUID();
    const serverSeed = generateServerSeed();
    const commitHash = commitmentHashFor(serverSeed);
    const validForLedgers = input.validForLedgers ?? 200;

    const record: CommitmentRecord = {
      roundId,
      gameId: input.gameId,
      serverSeed,
      commitHash,
      committedAtLedger: input.currentLedger,
      expiresAtLedger: input.currentLedger + validForLedgers,
      status: "committed",
    };

    await this.store.insertCommitment(record);
    await this.store.appendAudit("round.committed", {
      roundId,
      gameId: input.gameId,
      commitHash,
      committedAtLedger: record.committedAtLedger,
      expiresAtLedger: record.expiresAtLedger,
    });

    return {
      roundId,
      gameId: input.gameId,
      commitHash,
      committedAtLedger: record.committedAtLedger,
      expiresAtLedger: record.expiresAtLedger,
    };
  }

  async assertNotExpired(roundId: string, currentLedger: number): Promise<CommitmentRecord> {
    const record = await this.store.getCommitment(roundId);
    if (!record) {
      throw new Error(`No commitment found for round "${roundId}"`);
    }
    if (currentLedger > record.expiresAtLedger) {
      throw new RoundExpiredError(roundId);
    }
    return record;
  }
}
