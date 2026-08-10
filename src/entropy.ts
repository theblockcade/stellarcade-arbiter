import { randomBytes, createHash } from "node:crypto";

/**
 * Server-side counterpart of the SDK's `fairness.ts`. The derivation formula
 * MUST match exactly — this is what the SDK's `verifyProof()` recomputes
 * client-side. If these two ever drift, every published proof stops
 * verifying. See stellarcade-sdk/src/fairness.ts.
 */

export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function commitmentHashFor(serverSeed: string): string {
  return sha256Hex(serverSeed);
}

export interface DerivationInput {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  ledgerHash: string;
}

export function deriveOutcomeValue(input: DerivationInput): bigint {
  const material = `${input.serverSeed}:${input.clientSeed}:${input.nonce}:${input.ledgerHash}`;
  const hex = sha256Hex(material);
  return BigInt(`0x${hex}`);
}

export function mapToRange(value: bigint, size: number): number {
  if (size <= 0) {
    throw new RangeError(`Invalid outcome range size: ${size}`);
  }
  return Number(value % BigInt(size));
}
