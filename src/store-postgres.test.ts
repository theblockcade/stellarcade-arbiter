import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresRoundStore } from "./store-postgres.js";
import { verifyAuditChain } from "./audit.js";

// Real-database integration tests. Skipped when DATABASE_URL is absent —
// EXCEPT when CI_REQUIRE_DB=1, where a missing database FAILS the suite
// instead of silently skipping it. This mirrors the pattern documented in
// theblockcade/ANTIGRAVITY-BUILD-PROMPT.md: the concurrent-settlement
// atomicity guarantee is exactly the kind of thing that must be caught if
// it silently stops being exercised, not quietly skipped in CI forever.
const DATABASE_URL = process.env.DATABASE_URL;
const CI_REQUIRE_DB = process.env.CI_REQUIRE_DB === "1";

if (!DATABASE_URL && CI_REQUIRE_DB) {
  throw new Error("CI_REQUIRE_DB=1 but DATABASE_URL is unset — the Postgres integration suite cannot run.");
}

describe.skipIf(!DATABASE_URL)("PostgresRoundStore (integration)", () => {
  let pool: Pool;
  let store: PostgresRoundStore;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new PostgresRoundStore(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE settlements, commitments, audit_log RESTART IDENTITY CASCADE");
  });

  function commitment(roundId: string) {
    return {
      roundId,
      gameId: "coin-flip",
      serverSeed: "seed",
      commitHash: "hash",
      committedAtLedger: 1,
      expiresAtLedger: 100,
      status: "committed" as const,
    };
  }

  function settlement(roundId: string) {
    return {
      roundId,
      clientSeed: "client",
      nonce: 1,
      ledgerHash: "ledger",
      derivedValue: "deadbeef",
      outcome: { side: "heads" },
      payout: "10",
      settledAtLedger: 50,
    };
  }

  it("stores and retrieves a commitment", async () => {
    await store.insertCommitment(commitment("pg-r1"));
    const found = await store.getCommitment("pg-r1");
    expect(found?.roundId).toBe("pg-r1");
    expect(found?.status).toBe("committed");
  });

  it("marks a round revealed", async () => {
    await store.insertCommitment(commitment("pg-r2"));
    await store.markRevealed("pg-r2");
    const found = await store.getCommitment("pg-r2");
    expect(found?.status).toBe("revealed");
  });

  it(
    "enforces settlement idempotency via the UNIQUE constraint under real concurrent inserts",
    async () => {
      await store.insertCommitment(commitment("pg-r3"));

      // Unlike the in-memory store, these are genuinely concurrent database
      // round-trips racing against each other — this is the test that
      // actually exercises the UNIQUE constraint, not just JS's
      // single-threaded scheduling.
      const attempts = Array.from({ length: 10 }, () => store.insertSettlementIfAbsent(settlement("pg-r3")));
      const results = await Promise.all(attempts);

      expect(results.filter(Boolean)).toHaveLength(1);

      const found = await store.getCommitment("pg-r3");
      expect(found?.status).toBe("settled");

      const { rows } = await pool.query("SELECT count(*)::int AS count FROM settlements WHERE round_id = $1", [
        "pg-r3",
      ]);
      expect(rows[0].count).toBe(1);
    },
    15_000,
  );

  it("chains audit entries with a running hash, verifiable end to end", async () => {
    await store.appendAudit("round.committed", { roundId: "pg-r4" });
    await store.appendAudit("round.settled", { roundId: "pg-r4" });

    const entries = await store.listAudit();
    expect(entries).toHaveLength(2);
    expect(verifyAuditChain(entries).valid).toBe(true);
  });
});
