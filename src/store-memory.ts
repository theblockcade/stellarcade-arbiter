import { sha256Hex } from "./entropy.js";
import { RoundNotFoundError, type AuditEntry, type CommitmentRecord, type RoundStore, type SettlementRecord } from "./store.js";

const GENESIS_HASH = "0".repeat(64);

/**
 * In-process store for local development and tests. Never selected in
 * production — see `loadConfig()` in config.ts, which requires
 * `DATABASE_URL` outside development/test.
 */
export class InMemoryRoundStore implements RoundStore {
  private commitments = new Map<string, CommitmentRecord>();
  private settlements = new Map<string, SettlementRecord>();
  private audit: AuditEntry[] = [];

  async insertCommitment(record: CommitmentRecord): Promise<void> {
    this.commitments.set(record.roundId, { ...record });
  }

  async getCommitment(roundId: string): Promise<CommitmentRecord | null> {
    return this.commitments.get(roundId) ?? null;
  }

  async markRevealed(roundId: string): Promise<void> {
    const existing = this.commitments.get(roundId);
    if (!existing) {
      throw new RoundNotFoundError(roundId);
    }
    this.commitments.set(roundId, { ...existing, status: "revealed" });
  }

  async insertSettlementIfAbsent(record: SettlementRecord): Promise<boolean> {
    if (this.settlements.has(record.roundId)) {
      return false;
    }
    this.settlements.set(record.roundId, { ...record });
    const commitment = this.commitments.get(record.roundId);
    if (commitment) {
      this.commitments.set(record.roundId, { ...commitment, status: "settled" });
    }
    return true;
  }

  async getSettlement(roundId: string): Promise<SettlementRecord | null> {
    return this.settlements.get(roundId) ?? null;
  }

  async appendAudit(event: string, data: Record<string, unknown>): Promise<AuditEntry> {
    const prevHash = this.audit.length > 0 ? this.audit[this.audit.length - 1]!.hash : GENESIS_HASH;
    const seq = this.audit.length + 1;
    const createdAt = new Date().toISOString();
    const hash = sha256Hex(`${prevHash}:${seq}:${event}:${JSON.stringify(data)}:${createdAt}`);
    const entry: AuditEntry = { seq, event, data, prevHash, hash, createdAt };
    this.audit.push(entry);
    return entry;
  }

  async listAudit(sinceSeq = 0): Promise<AuditEntry[]> {
    return this.audit.filter((e) => e.seq > sinceSeq);
  }
}
