import { commitmentHashFor, deriveOutcomeValue } from "./entropy.js";
import { resolverFor } from "./resolvers.js";
import type { FairnessProof } from "./proofs.js";

export interface ReplayResult {
  reproducible: boolean;
  commitmentMatches: boolean;
  derivedValueMatches: boolean;
  outcomeMatches: boolean;
  recomputedOutcome: unknown;
  reason?: string;
}

/**
 * Independently re-derives a round's outcome from its published proof alone
 * — no store access, no trust in whatever the arbiter originally computed.
 * This is the server-side twin of the SDK's `verifyProof()`; it exists so
 * an operator (or an outside auditor with just the proof JSON) can settle a
 * dispute without taking the arbiter's live state as ground truth.
 */
export function replayRound(proof: FairnessProof, stake: bigint): ReplayResult {
  const commitmentMatches = commitmentHashFor(proof.serverSeed) === proof.commitHash;

  const derivedValue = deriveOutcomeValue({
    serverSeed: proof.serverSeed,
    clientSeed: proof.clientSeed,
    nonce: proof.nonce,
    ledgerHash: proof.ledgerHash,
  });
  const derivedValueMatches = derivedValue.toString(16) === proof.derivedValue;

  const resolve = resolverFor(proof.gameId);
  // The resolver needs the original player choice to compute `won`, which
  // the proof does not carry (it only carries the resolved outcome) — so we
  // recompute against a neutral choice and compare the outcome's
  // *derivation-dependent* fields (e.g. `roll`, `side`) rather than `won`.
  const { outcome: recomputedOutcome } = resolve(derivedValue, stake, {});

  const outcomeMatches = derivationFieldsMatch(proof.outcome, recomputedOutcome);

  const reproducible = commitmentMatches && derivedValueMatches && outcomeMatches;

  return {
    reproducible,
    commitmentMatches,
    derivedValueMatches,
    outcomeMatches,
    recomputedOutcome,
    reason: reproducible
      ? undefined
      : !commitmentMatches
        ? "Revealed server seed does not hash to the published commitment"
        : !derivedValueMatches
          ? "Derived value does not match the value published in the proof"
          : "Recomputed outcome does not match the published outcome",
  };
}

function derivationFieldsMatch(published: unknown, recomputed: unknown): boolean {
  if (typeof published !== "object" || published === null || typeof recomputed !== "object" || recomputed === null) {
    return published === recomputed;
  }
  const p = published as Record<string, unknown>;
  const r = recomputed as Record<string, unknown>;
  // Compare every field except `won`, which depends on the player's choice
  // and is not part of the proof's derivation-dependent claim.
  return Object.keys(r)
    .filter((key) => key !== "won")
    .every((key) => p[key] === r[key]);
}
