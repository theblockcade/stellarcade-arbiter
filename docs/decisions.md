# Decisions (ADRs)

Lightweight architecture decision records — one entry per decision, newest
first. Each entry states the decision, the alternatives considered, and why
they lost.

## 2026-08 — Postgres UNIQUE constraint for settlement idempotency, not an application-level lock

**Decision:** `insertSettlementIfAbsent` relies on `settlements.round_id`
being a `PRIMARY KEY` and `INSERT ... ON CONFLICT DO NOTHING`, not a
distributed lock (Redis, advisory lock held across the request, etc).

**Alternatives considered:**
- A Postgres advisory lock held for the duration of settlement — works, but
  adds a lock-management failure mode (a crashed process holding a lock
  past the request lifetime) for no benefit over the constraint approach.
- An in-application mutex (e.g. a `Map<roundId, Promise>`) — only safe
  within a single process; the moment the arbiter runs more than one
  replica, this stops working. Since horizontal scaling is the whole point
  of separating settlement into its own service, this was rejected.

**Consequence:** the in-memory store (`InMemoryRoundStore`) is dev/test only
and cannot provide the same cross-process guarantee — which is exactly why
`loadConfig()` refuses to boot without `DATABASE_URL` outside
development/test. See [technical-doc.md](technical-doc.md#concurrency).

## 2026-08 — The arbiter fetches the ledger hash itself, never accepts it from the caller

**Decision:** `LedgerClient.getCurrentLedger()` is called server-side at
settle time; the HTTP `/rounds/:roundId/settle` request body does not accept
a `ledgerHash` field.

**Why:** `ledgerHash` is one of four inputs to the outcome derivation. If a
client could supply it, a sufficiently motivated player could query several
recent ledger hashes off-chain, compute the derived outcome for each against
their chosen `clientSeed`/`nonce`, and submit whichever `ledgerHash` produces
their preferred result. Public information does not mean caller-suppliable
information here.

## 2026-08 — Commit-reveal now, VRF later

**Decision:** ship commit-reveal (SHA-256, see [fairness-spec.md](fairness-spec.md))
for v1; leave `src/vrf.ts` as a documented, unimplemented interface rather
than a partial/broken VRF implementation.

**Why:** commit-reveal is fair and independently verifiable today, with a
well-understood security model. A real VRF (RFC 9381-style, elliptic-curve
based) closes a real gap — pre-reveal verifiability — but a rushed,
under-tested VRF implementation is worse than an honestly-labeled gap. See
`src/vrf.ts`'s module comment.

## 2026-08 — Server seed never appears in any pre-settlement API response

**Decision:** `POST /games/:gameId/commit` returns only `commitHash`;
`serverSeed` is only ever returned by `GET /proofs/:roundId`, and only after
`status: "settled"`.

**Why:** this is the entire point of commit-reveal. A leaked pre-settlement
seed (via a verbose log line, an overly broad API response, a debug
endpoint) would let anyone compute the outcome before betting. `ProofArchive`
enforces this at the type level — its return type has no path that includes
`serverSeed` before settlement.
