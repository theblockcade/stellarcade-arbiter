# stellarcade-arbiter

[![CI](https://github.com/TheBlockCade/stellarcade-arbiter/actions/workflows/ci.yml/badge.svg)](https://github.com/TheBlockCade/stellarcade-arbiter/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

The provably-fair randomness and settlement service for **TheBlockCade**.
Publishes a hashed commitment before any bet is accepted, reveals after
settlement, and archives a durable proof that anyone — not just the player —
can verify offline. See [`stellarcade-sdk`](https://github.com/TheBlockCade/stellarcade-sdk)'s
`verifyProof()` for the client-side counterpart.

## Why this exists

"Provably fair" is a claim, not a vibe. This service is what makes the claim
checkable: commit-reveal randomness, an append-only hash-chained audit log,
and a dispute-replay path that reconstructs any settled round from its
published proof alone, without trusting the arbiter's live database.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/games/:gameId/commit` | Publish a fresh round commitment |
| POST | `/rounds/:roundId/settle` | Reveal, derive the outcome, settle idempotently |
| GET | `/proofs/:roundId` | Fetch the durable fairness proof for a settled round |
| POST | `/verify` | Server-side dispute replay of a proof |
| GET | `/audit/verify` | Verify the audit log's hash chain is unbroken |

Full request/response shapes: [docs/technical-doc.md](docs/technical-doc.md).

## Running locally

```bash
cp .env.example .env        # set STELLAR_NETWORK, STELLAR_RPC_URL, DATABASE_URL
docker compose up -d         # Postgres
npm install
npm run build                # applies migrations/001_init.sql yourself — see below
psql "$DATABASE_URL" -f migrations/001_init.sql
npm run dev
```

`NODE_ENV=development` (the default) allows running with no `DATABASE_URL` at
all — an in-memory store is used instead. **This never happens outside
development/test**: `loadConfig()` refuses to boot in any other `NODE_ENV`
without `DATABASE_URL` set. See [docs/decisions.md](docs/decisions.md) for why.

## Testing

```bash
npm test
```

The full round lifecycle — commit → settle → proof → verify → audit — is
covered end-to-end in `src/app.test.ts` via Fastify's `inject()`, no network
required. Concurrency safety (two settlement attempts for the same round)
is covered in `src/settle.test.ts` and enforced at the database level via a
`UNIQUE` constraint — see `migrations/001_init.sql`.

## Documentation

- [Technical design](docs/technical-doc.md)
- [Fairness spec](docs/fairness-spec.md) — the exact commit-reveal algorithm
- [Decisions (ADRs)](docs/decisions.md)
- [Operator runbook](docs/operator-runbook.md)
- [Security audit](docs/security-audit.md)

## Deployment

`render.yaml` deploys the service plus a managed Postgres on Render's free
tier — see the file for the free-tier caveats (sleep after idle, DB expiry).
`.github/workflows/keepalive.yml` pings `/health` on a schedule to avoid
unnecessary cold starts during active development.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0 — see [LICENSE](LICENSE). See [NOTICE](NOTICE) for third-party
attribution.
