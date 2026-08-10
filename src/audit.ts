import { sha256Hex } from "./entropy.js";
import type { AuditEntry, RoundStore } from "./store.js";

const GENESIS_HASH = "0".repeat(64);

export interface AuditVerificationResult {
  valid: boolean;
  brokenAtSeq?: number;
  reason?: string;
}

/**
 * Recomputes every entry's hash from its own fields plus the previous
 * entry's hash, and confirms the chain is unbroken. Any edited, deleted, or
 * reordered historical entry breaks the chain from that point forward —
 * that break is the tamper signal, deliberately: the point of a hash chain
 * is not to prevent tampering (an operator with DB access always can) but
 * to make it detectable after the fact.
 */
export function verifyAuditChain(entries: AuditEntry[]): AuditVerificationResult {
  let expectedPrevHash = GENESIS_HASH;

  for (const entry of entries) {
    if (entry.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        brokenAtSeq: entry.seq,
        reason: `Entry ${entry.seq} references prevHash "${entry.prevHash}" but the chain expected "${expectedPrevHash}"`,
      };
    }

    const recomputed = sha256Hex(
      `${entry.prevHash}:${entry.seq}:${entry.event}:${JSON.stringify(entry.data)}:${entry.createdAt}`,
    );
    if (recomputed !== entry.hash) {
      return {
        valid: false,
        brokenAtSeq: entry.seq,
        reason: `Entry ${entry.seq}'s stored hash does not match its recomputed hash — content was altered after the fact`,
      };
    }

    expectedPrevHash = entry.hash;
  }

  return { valid: true };
}

export async function verifyStoredAuditChain(store: RoundStore): Promise<AuditVerificationResult> {
  const entries = await store.listAudit(0);
  return verifyAuditChain(entries);
}
