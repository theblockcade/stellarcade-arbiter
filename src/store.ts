export type RoundStatus = "committed" | "revealed" | "settled";

export interface CommitmentRecord {
  roundId: string;
  gameId: string;
  serverSeed: string;
  commitHash: string;
  committedAtLedger: number;
  expiresAtLedger: number;
  status: RoundStatus;
}

export interface SettlementRecord {
  roundId: string;
  clientSeed: string;
  nonce: number;
  ledgerHash: string;
  derivedValue: string;
  outcome: unknown;
  payout: string;
  settledAtLedger: number;
}

export interface AuditEntry {
  seq: number;
  event: string;
  data: Record<string, unknown>;
  prevHash: string;
  hash: string;
  createdAt: string;
}

/**
 * Storage contract for round lifecycle state. Two implementations exist:
 * {@link InMemoryRoundStore} for dev/test, and a Postgres-backed store for
 * everywhere else. `loadConfig()` in config.ts refuses to boot in
 * non-dev/test environments without DATABASE_URL, so the in-memory store
 * can never be selected silently in production — see RoundStore selection
 * in server.ts.
 */
export interface RoundStore {
  insertCommitment(record: CommitmentRecord): Promise<void>;
  getCommitment(roundId: string): Promise<CommitmentRecord | null>;
  markRevealed(roundId: string): Promise<void>;

  /**
   * Inserts a settlement iff one does not already exist for this round.
   * Returns `true` if this call performed the insert (i.e. this caller
   * "won" settlement), `false` if a settlement already existed. This is the
   * mechanism that makes concurrent settlement attempts for the same round
   * safe — see settle.ts.
   */
  insertSettlementIfAbsent(record: SettlementRecord): Promise<boolean>;
  getSettlement(roundId: string): Promise<SettlementRecord | null>;

  appendAudit(event: string, data: Record<string, unknown>): Promise<AuditEntry>;
  listAudit(sinceSeq?: number): Promise<AuditEntry[]>;
}

export class RoundNotFoundError extends Error {
  constructor(roundId: string) {
    super(`No commitment found for round "${roundId}"`);
    this.name = "RoundNotFoundError";
  }
}
