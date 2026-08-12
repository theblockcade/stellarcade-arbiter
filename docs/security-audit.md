# Security Audit (self-audit, v1)

This is a review of this repository's own code, written by the people who
wrote it, before any external review. Treat it as a starting punch list, not
a clean bill of health. Findings are ordered most to least severe.

## 🟠 HIGH

**H1 — ~~No authentication on any endpoint.~~ Fixed** — `POST
/games/:gameId/commit` and `POST /rounds/:roundId/settle` now require a
matching `x-api-key` header when `ARBITER_API_KEYS` is configured
(required in production; `loadConfig()` refuses to boot without it, same
enforcement pattern as M2's `CORS_ORIGIN`). `/verify`, `/proofs/:id`, and
`/audit/verify` stay public by design — read-only proof-checking. See
`src/app.ts`'s `requireApiKey` and `src/config.ts`.

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

**M1 — ~~No rate limiting on `/games/:gameId/commit`.~~ Fixed** — both
`/games/:gameId/commit` and `/rounds/:roundId/settle` are now per-IP rate
limited via `@fastify/rate-limit` (`ARBITER_API_KEYS` config's neighbors
`RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS`, default 30 req/min). Implemented
here rather than at a gateway layer — no `api-gateway` service exists in
the `stellarcade` monorepo as of this fix.

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
2. ~~H1 (authentication) — blocks any public deployment.~~ Fixed.
3. M3 — required before mainnet, not before testnet. (M1, M2 fixed.)
4. L2 — cleanup, no deployment blocker. (L1 fixed.)

## Closing state (this pass)

M2 and L1 were cheap, mechanical fixes with no design tradeoff, so they were
fixed immediately. H1 and M1 were closed in a later pass (API-key auth +
per-IP rate limiting) once the service was actually being deployed — see
the H1/M1 entries above for what shipped. H2 and M3 remain open — each
needs either a design decision (M3's admin-control surface) or integration
work outside this repo's current scope (H2 needs the `prize-pool` contract
wired up) and so are left honestly unresolved rather than papered over.
**H2 in particular still blocks any deployment that touches real funds —
testnet only until it's closed.**

## Re-audit trigger

Re-run this audit whenever `src/settle.ts`, `src/policy.ts`, or the
migrations change — those are the settlement-critical paths this document
exists to track.
