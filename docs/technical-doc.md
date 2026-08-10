# Technical Design

## Purpose

stellarcade-arbiter is the single source of truth for "what happened in this
round and why". It owns three responsibilities:

1. **Commit** — publish a hashed server seed before any stake exists.
2. **Settle** — reveal, derive the outcome deterministically, pay out once.
3. **Prove** — archive everything needed for anyone to independently
   reproduce the outcome, forever.

## Round lifecycle

```
POST /games/:gameId/commit
  → Beacon.commitRound
    - generates a random 32-byte serverSeed (entropy.ts)
    - publishes commitHash = sha256(serverSeed)
    - persists {roundId, gameId, serverSeed, commitHash, status: "committed"}
    - appends a "round.committed" audit entry

POST /rounds/:roundId/settle
  → Settler.settle
    - rejects if the round is past its expiry ledger (RoundExpiredError)
    - rejects if the stake is outside per-game policy limits
    - if a settlement already exists for this round, returns it unchanged
      (idempotent — see "Concurrency" below)
    - otherwise: fetches the CURRENT ledger from LedgerClient (not the
      caller) for the ledgerHash input
    - derives outcome = sha256(serverSeed:clientSeed:nonce:ledgerHash)
    - resolves the game-specific outcome + payout (resolvers.ts)
    - checks the payout against per-game and global policy caps
    - inserts the settlement (INSERT ... ON CONFLICT DO NOTHING in Postgres)
    - appends a "round.settled" audit entry

GET /proofs/:roundId
  → ProofArchive.getProof
    - only returns data for status: "settled" rounds
    - bundles commitHash, serverSeed, clientSeed, nonce, ledgerHash,
      derivedValue, outcome — everything needed to replay the round

POST /verify
  → replayRound (dispute.ts)
    - recomputes commitHash from the proof's serverSeed
    - recomputes derivedValue from the proof's seed material
    - recomputes the outcome and compares derivation-dependent fields
    - returns {reproducible, commitmentMatches, derivedValueMatches, outcomeMatches}
```

## Concurrency

Two settlement attempts for the same round must not double-pay. This is
enforced at the storage layer, not in application logic:

- **Postgres** (production): `settlements.round_id` is the primary key, and
  `insertSettlementIfAbsent` uses `INSERT ... ON CONFLICT (round_id) DO
  NOTHING`. Only one of any number of concurrent inserts succeeds, across
  any number of arbiter processes.
- **In-memory** (dev/test only): a `Map.has` + `Map.set` with no `await`
  between them, which is atomic within a single Node process because
  nothing yields the event loop in between. This is NOT safe across
  processes — which is exactly why production requires Postgres (see
  [decisions.md](decisions.md)).

Covered by `src/settle.test.ts`'s "handles a settlement race" test, which
fires three concurrent `settle()` calls at the same round and asserts
exactly one wins.

## Why the arbiter determines the ledger hash, not the caller

`ledgerHash` feeds directly into the outcome derivation. If a client could
supply it, they could shop around for a ledger hash that favors their
preferred result before submitting a settle request. `LedgerClient` (see
`src/ledger.ts`) fetches the current ledger from Horizon at settle time —
the caller only supplies their `clientSeed`, `nonce`, and `choice`.

## Audit log

Every commit and settlement appends a hash-chained entry: each entry's hash
covers its own data plus the previous entry's hash. `verifyAuditChain`
(audit.ts) recomputes the whole chain and flags the first entry where it
breaks. See [fairness-spec.md](fairness-spec.md) for what this does and
does not protect against.
