import type { RoundStore } from "./store.js";

export class ProofNotAvailableError extends Error {
  constructor(
    roundId: string,
    public readonly reason: string,
  ) {
    super(`Proof for round "${roundId}" is not available: ${reason}`);
    this.name = "ProofNotAvailableError";
  }
}

export interface FairnessProof {
  roundId: string;
  gameId: string;
  commitHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  ledgerHash: string;
  derivedValue: string;
  outcome: unknown;
}

/**
 * Publishes the durable, publicly queryable proof for a settled round. The
 * server seed only appears here — after settlement — never in any
 * commitment-stage response. This is what stellarcade-sdk's `verifyProof()`
 * consumes; the shape must stay in lockstep with that function's expected
 * input.
 */
export class ProofArchive {
  constructor(private readonly store: RoundStore) {}

  async getProof(roundId: string): Promise<FairnessProof> {
    const commitment = await this.store.getCommitment(roundId);
    if (!commitment) {
      throw new ProofNotAvailableError(roundId, "no commitment on record");
    }
    if (commitment.status !== "settled") {
      throw new ProofNotAvailableError(roundId, `round is "${commitment.status}", not settled yet`);
    }

    const settlement = await this.store.getSettlement(roundId);
    if (!settlement) {
      throw new ProofNotAvailableError(roundId, "commitment is settled but no settlement record was found");
    }

    return {
      roundId,
      gameId: commitment.gameId,
      commitHash: commitment.commitHash,
      serverSeed: commitment.serverSeed,
      clientSeed: settlement.clientSeed,
      nonce: settlement.nonce,
      ledgerHash: settlement.ledgerHash,
      derivedValue: settlement.derivedValue,
      outcome: settlement.outcome,
    };
  }
}
