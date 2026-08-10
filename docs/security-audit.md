# Security Audit (self-audit, v1)

This is a review of this repository's own code, written by the people who
wrote it, before any external review. Treat it as a starting punch list, not
a clean bill of health. Findings are ordered most to least severe.

## 🟠 HIGH

**H1 — No authentication on any endpoint.** `/games/:gameId/commit`,
`/rounds/:roundId/settle`, and `/verify` are all open. Anything that can
reach the service can commit rounds, attempt settlement, or run replay
checks. For v1 this is mitigated by policy limits (`src/policy.ts`) capping
stake/payout, but there is no per-caller rate limit or API key requirement.
**Remediation:** add an API-key or mTLS layer in front of `/rounds/:id/settle`
before any real funds are involved; `/verify` and `/proofs/:id` can stay
public since they're read-only proof-checking endpoints by design.

**H2 — Settlement trusts the caller's claimed stake without on-chain
verification.** `POST /rounds/:roundId/settle` accepts a `stake` field and
computes a payout against it, but nothing in this service confirms that
stake was actually locked on-chain for this round. **This is a real gap, not
a hypothetical one** — v1 has no integration with the `prize-pool` contract
to verify the stake transaction. **Remediation:** before mainnet, settlement
must verify a confirmed on-chain transaction locking exactly `stake` for
`roundId` before deriving a payout, not just apply policy limits to a
self-reported number.

## 🟡 MEDIUM

**M1 — No rate limiting on `/games/:gameId/commit`.** An attacker could spam
commitments, growing the `commitments` table and (in Postgres) generating
audit log entries for rounds that never settle. **Remediation:** add
per-IP/per-API-key rate limiting at the gateway layer (`stellarcade`
monorepo's `api-gateway` service is the intended place for this — see that
repo's docs).

**M2 — `CORS_ORIGIN` defaults to `*`.** ~~Fine for local dev, wrong for
production.~~ **Fixed in this pass** — `loadConfig()` now throws a
`ConfigError` if `CORS_ORIGIN` is unset (or explicitly `"*"`) while
`NODE_ENV=production`. See `src/config.ts` and `src/config.test.ts`.

**M3 — Circuit breaker has no runtime control surface.** `CircuitBreaker`
(policy.ts) can only be tripped by code that holds a reference to the same
instance — there's no admin endpoint, so tripping it today means restarting
the process with different startup code. See
[operator-runbook.md](operator-runbook.md).

## 🟢 LOW

**L1 — ~~`loadConfig()`'s `BigInt(env.MAX_PAYOUT ?? ...)` throws an
unvalidated `SyntaxError`~~ Fixed in this pass** — `parsePositiveBigInt()`
validates the env value against `/^[0-9]+$/` and throws a `ConfigError` with
a clear message before calling `BigInt()`.

**L2 — `GET /audit/verify` does a full table scan with no pagination.**
Fine at today's scale; will need `sinceSeq` support wired to the HTTP layer
(the store method already supports it) before the audit log grows large.

## ℹ️ INFO

- No dependency vulnerability scanning has run yet outside CI — the CI
  workflow includes `npm audit --audit-level=high`, but no historical scan
  predates this document.
- No load testing has been performed. `docs/operator-runbook.md`'s
  operational gaps list is the closest thing to a capacity assessment today.
- VRF is explicitly unimplemented — see `src/vrf.ts` and
  [decisions.md](decisions.md). This is a documented scope decision, not an
  oversight.

## Remediation order

1. H2 (on-chain stake verification) — blocks any real-money deployment.
2. H1 (authentication) — blocks any public deployment.
3. M1, M3 — required before mainnet, not before testnet. (M2 fixed.)
4. L2 — cleanup, no deployment blocker. (L1 fixed.)

## Closing state (this pass)

M2 and L1 were cheap, mechanical fixes with no design tradeoff, so they were
fixed immediately rather than left as tracked debt. H1, H2, M1, M3, and L2
remain open — each needs either a design decision (H1's auth mechanism,
M1's rate-limit tier) or integration work outside this repo's current scope
(H2 needs the `prize-pool` contract wired up) and so are left honestly
unresolved rather than papered over.

## Re-audit trigger

Re-run this audit whenever `src/settle.ts`, `src/policy.ts`, or the
migrations change — those are the settlement-critical paths this document
exists to track.
