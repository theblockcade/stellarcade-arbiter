import type { Pool } from "pg";
import { sha256Hex } from "./entropy.js";
import { RoundNotFoundError, type AuditEntry, type CommitmentRecord, type RoundStore, type SettlementRecord } from "./store.js";

const GENESIS_HASH = "0".repeat(64);

/**
 * Postgres-backed store. Concurrent-settlement safety comes from a UNIQUE
 * constraint on `settlements.round_id` (see migrations/001_init.sql):
 * `INSERT ... ON CONFLICT (round_id) DO NOTHING` makes
 * `insertSettlementIfAbsent` race-safe across multiple arbiter instances,
 * not just multiple in-process callers — the in-memory store's
 * check-then-set is only safe within a single process.
 */
export class PostgresRoundStore implements RoundStore {
  constructor(private readonly pool: Pool) {}

  async insertCommitment(record: CommitmentRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO commitments
         (round_id, game_id, server_seed, commit_hash, committed_at_ledger, expires_at_ledger, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        record.roundId,
        record.gameId,
        record.serverSeed,
        record.commitHash,
        record.committedAtLedger,
        record.expiresAtLedger,
        record.status,
      ],
    );
  }

  async getCommitment(roundId: string): Promise<CommitmentRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT round_id, game_id, server_seed, commit_hash, committed_at_ledger, expires_at_ledger, status
       FROM commitments WHERE round_id = $1`,
      [roundId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      roundId: row.round_id,
      gameId: row.game_id,
      serverSeed: row.server_seed,
      commitHash: row.commit_hash,
      committedAtLedger: row.committed_at_ledger,
      expiresAtLedger: row.expires_at_ledger,
      status: row.status,
    };
  }

  async markRevealed(roundId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE commitments SET status = 'revealed' WHERE round_id = $1 AND status != 'settled'`,
      [roundId],
    );
    if (result.rowCount === 0) {
      const existing = await this.getCommitment(roundId);
      if (!existing) throw new RoundNotFoundError(roundId);
    }
  }

  async insertSettlementIfAbsent(record: SettlementRecord): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO settlements
         (round_id, client_seed, nonce, ledger_hash, derived_value, outcome, payout, settled_at_ledger)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (round_id) DO NOTHING`,
      [
        record.roundId,
        record.clientSeed,
        record.nonce,
        record.ledgerHash,
        record.derivedValue,
        JSON.stringify(record.outcome),
        record.payout,
        record.settledAtLedger,
      ],
    );
    const inserted = (result.rowCount ?? 0) > 0;
    if (inserted) {
      await this.pool.query(`UPDATE commitments SET status = 'settled' WHERE round_id = $1`, [record.roundId]);
    }
    return inserted;
  }

  async getSettlement(roundId: string): Promise<SettlementRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT round_id, client_seed, nonce, ledger_hash, derived_value, outcome, payout, settled_at_ledger
       FROM settlements WHERE round_id = $1`,
      [roundId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      roundId: row.round_id,
      clientSeed: row.client_seed,
      nonce: row.nonce,
      ledgerHash: row.ledger_hash,
      derivedValue: row.derived_value,
      outcome: row.outcome,
      payout: row.payout,
      settledAtLedger: row.settled_at_ledger,
    };
  }

  async appendAudit(event: string, data: Record<string, unknown>): Promise<AuditEntry> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1 FOR UPDATE`,
      );
      const prevHash = rows[0]?.hash ?? GENESIS_HASH;
      const createdAt = new Date().toISOString();
      const inserted = await client.query(
        `INSERT INTO audit_log (event, data, prev_hash, hash, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING seq`,
        [event, JSON.stringify(data), prevHash, "", createdAt],
      );
      const seq = inserted.rows[0].seq as number;
      const hash = sha256Hex(`${prevHash}:${seq}:${event}:${JSON.stringify(data)}:${createdAt}`);
      await client.query(`UPDATE audit_log SET hash = $1 WHERE seq = $2`, [hash, seq]);
      await client.query("COMMIT");
      return { seq, event, data, prevHash, hash, createdAt };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listAudit(sinceSeq = 0): Promise<AuditEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT seq, event, data, prev_hash, hash, created_at FROM audit_log WHERE seq > $1 ORDER BY seq ASC`,
      [sinceSeq],
    );
    return rows.map((row) => ({
      seq: row.seq,
      event: row.event,
      data: row.data,
      prevHash: row.prev_hash,
      hash: row.hash,
      createdAt: row.created_at,
    }));
  }
}
