# Operator Runbook

## Health check

```bash
curl https://<host>/health
# {"status":"ok"}
```

## Verifying the audit log hasn't been tampered with

```bash
curl https://<host>/audit/verify
# {"valid": true}
# or
# {"valid": false, "brokenAtSeq": 42, "reason": "..."}
```

If this ever returns `valid: false`, treat it as a security incident: the
audit log has either been directly edited in the database, or there is a bug
in the append path. Trip the circuit breaker (see below) and investigate
before allowing further settlement.

## Tripping the circuit breaker

There is currently no HTTP endpoint for this — it requires a process
restart with the breaker pre-tripped, or a code change wiring an admin
endpoint (tracked as a known gap, see [security-audit.md](security-audit.md)).
For now: stop the service (`docker compose stop arbiter` / stop the Render
service) rather than let it keep settling rounds if something looks wrong.
An open circuit breaker in code (`CircuitBreaker.trip()`) makes
`Settler.settle` reject every call with a `PolicyViolationError` — see
`src/policy.ts`.

## Investigating a disputed round

1. Fetch the proof: `GET /proofs/:roundId`
2. Replay it independently: `POST /verify` with `{ proof, stake }`
3. If `reproducible: false`, check which field mismatched
   (`commitmentMatches` / `derivedValueMatches` / `outcomeMatches`) — see
   `docs/fairness-spec.md` for what each check means
4. Cross-check the audit log entries for that `roundId` via `GET
   /audit/verify` and the raw `audit_log` table — every commit and
   settlement should have a corresponding entry

## Rotating the database credentials

1. Provision new credentials in your Postgres provider (Neon, Render-managed
   Postgres, etc)
2. Update `DATABASE_URL` in the deployment environment (Render dashboard —
   marked `sync:false` in `render.yaml`, so it's not stored in git)
3. Restart the service — `pg.Pool` picks up the new connection string on
   next boot; there is no live credential swap

## Known operational gaps (be honest)

- No admin API for tripping the circuit breaker at runtime — requires a
  restart today.
- No automated anomaly detection feeding the circuit breaker — it is
  manually operated.
- No key rotation procedure for signing keys, because this service does not
  hold a signing key today (settlement authorizes payout via a policy check;
  actual fund movement is a separate on-chain step outside this repo's
  scope). If that changes, this runbook needs a KMS section before it ships.
- The free-tier Render deployment (`render.yaml`) sleeps after 15 minutes
  idle and the managed Postgres expires after 30 days — see that file's
  comments. Not suitable for anything beyond a testnet demo.
