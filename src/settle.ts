import { Beacon } from "./beacon.js";
import { deriveOutcomeValue } from "./entropy.js";
import { assertPayoutAllowed, assertStakeAllowed, CircuitBreaker } from "./policy.js";
import { resolverFor } from "./resolvers.js";
import type { RoundStore, SettlementRecord } from "./store.js";

export interface SettleRoundInput {
  roundId: string;
  stake: bigint;
  clientSeed: string;
  nonce: number;
  ledgerHash: string;
  choice: unknown;
  currentLedger: number;
}

export interface SettleResult {
  roundId: string;
  outcome: unknown;
  payout: bigint;
  derivedValue: string;
  wasFirstSettlement: boolean;
}

/**
 * Orchestrates settlement: validates the round hasn't expired, derives the
 * outcome from the revealed seed material, checks it against policy limits,
 * and persists the settlement idempotently.
 *
 * Idempotency matters because settlement can be triggered from more than
 * one place (a webhook retry, an operator replay, a client poll racing a
 * server-side job) — `store.insertSettlementIfAbsent` guarantees only the
 * first caller actually pays out; everyone else gets the existing result
 * back via `wasFirstSettlement: false`.
 */
export class Settler {
  private readonly beacon: Beacon;

  constructor(
    private readonly store: RoundStore,
    private readonly maxPayout: bigint,
    private readonly circuitBreaker: CircuitBreaker = new CircuitBreaker(),
  ) {
    this.beacon = new Beacon(store);
  }

  async settle(input: SettleRoundInput): Promise<SettleResult> {
    this.circuitBreaker.assertClosed();

    const commitment = await this.beacon.assertNotExpired(input.roundId, input.currentLedger);
    assertStakeAllowed(commitment.gameId, input.stake);

    const existing = await this.store.getSettlement(input.roundId);
    if (existing) {
      return {
        roundId: input.roundId,
        outcome: existing.outcome,
        payout: BigInt(existing.payout),
        derivedValue: existing.derivedValue,
        wasFirstSettlement: false,
      };
    }

    await this.store.markRevealed(input.roundId);

    const derivedValue = deriveOutcomeValue({
      serverSeed: commitment.serverSeed,
      clientSeed: input.clientSeed,
      nonce: input.nonce,
      ledgerHash: input.ledgerHash,
    });

    const resolve = resolverFor(commitment.gameId);
    const { outcome, payout } = resolve(derivedValue, input.stake, input.choice);

    assertPayoutAllowed(commitment.gameId, input.stake, payout, this.maxPayout);

    const record: SettlementRecord = {
      roundId: input.roundId,
      clientSeed: input.clientSeed,
      nonce: input.nonce,
      ledgerHash: input.ledgerHash,
      derivedValue: derivedValue.toString(16),
      outcome,
      payout: payout.toString(),
      settledAtLedger: input.currentLedger,
    };

    const inserted = await this.store.insertSettlementIfAbsent(record);

    if (!inserted) {
      // Lost the race to a concurrent settlement attempt — return its result.
      const winner = await this.store.getSettlement(input.roundId);
      if (!winner) {
        throw new Error(`Settlement race for round "${input.roundId}" resolved with no record`);
      }
      return {
        roundId: input.roundId,
        outcome: winner.outcome,
        payout: BigInt(winner.payout),
        derivedValue: winner.derivedValue,
        wasFirstSettlement: false,
      };
    }

    await this.store.appendAudit("round.settled", {
      roundId: input.roundId,
      gameId: commitment.gameId,
      derivedValue: record.derivedValue,
      outcome,
      payout: record.payout,
    });

    return {
      roundId: input.roundId,
      outcome,
      payout,
      derivedValue: record.derivedValue,
      wasFirstSettlement: true,
    };
  }
}
