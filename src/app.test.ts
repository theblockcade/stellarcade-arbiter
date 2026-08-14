import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { StaticLedgerClient } from "./ledger.js";
import { InMemoryRoundStore } from "./store-memory.js";

function makeApp() {
  const store = new InMemoryRoundStore();
  const ledgerClient = new StaticLedgerClient({
    sequence: 100,
    hash: "ledger-hash-1",
  });
  const app = buildApp({
    store,
    ledgerClient,
    maxPayout: 5000_0000000n,
    corsOrigin: "*",
  });
  return { app, store, ledgerClient };
}

function makeAuthedApp(apiKeys: string[]) {
  const store = new InMemoryRoundStore();
  const ledgerClient = new StaticLedgerClient({
    sequence: 100,
    hash: "ledger-hash-1",
  });
  const app = buildApp({
    store,
    ledgerClient,
    maxPayout: 5000_0000000n,
    corsOrigin: "*",
    apiKeys,
    rateLimitMax: 2,
    rateLimitWindowMs: 60_000,
  });
  return { app, store, ledgerClient };
}

describe("GET /health", () => {
  // Higher timeout than the vitest default (5000ms): this is typically the
  // first app.inject() call in the whole run, which pays a one-time cold
  // cost for fastify/ajv/avvio module load + JIT + the async plugin boot
  // sequence (cors, rate-limit, the deferred app.after() registration).
  // Every other test in this file builds its own app too but reuses that
  // already-warmed code, so only this one needs the extra headroom, which
  // matters when many test files are transforming/collecting in parallel
  // and briefly saturate the CPU.
  it(
    "returns ok",
    async () => {
      const { app } = makeApp();
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
    },
    15_000,
  );
});

describe("round lifecycle over HTTP", () => {
  it("commits, settles, publishes a proof, and verifies it end to end", async () => {
    const { app } = makeApp();

    const commitRes = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
    });
    expect(commitRes.statusCode).toBe(200);
    const commitment = commitRes.json();
    expect(commitment.commitHash).toMatch(/^[0-9a-f]{64}$/);

    const settleRes = await app.inject({
      method: "POST",
      url: `/rounds/${commitment.roundId}/settle`,
      payload: {
        stake: "100000000",
        clientSeed: "client-seed",
        nonce: 1,
        choice: { side: "heads" },
      },
    });
    expect(settleRes.statusCode).toBe(200);
    const settled = settleRes.json();
    expect(settled.roundId).toBe(commitment.roundId);

    const proofRes = await app.inject({
      method: "GET",
      url: `/proofs/${commitment.roundId}`,
    });
    expect(proofRes.statusCode).toBe(200);
    const proof = proofRes.json();
    expect(proof.commitHash).toBe(commitment.commitHash);

    const verifyRes = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { proof, stake: "100000000" },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().reproducible).toBe(true);

    const auditRes = await app.inject({ method: "GET", url: "/audit/verify" });
    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().valid).toBe(true);
  });

  it("404s a proof request for an unsettled round", async () => {
    const { app } = makeApp();
    const commitRes = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
    });
    const commitment = commitRes.json();

    const proofRes = await app.inject({
      method: "GET",
      url: `/proofs/${commitment.roundId}`,
    });
    expect(proofRes.statusCode).toBe(404);
  });

  it("422s a settlement with a stake below policy minimum", async () => {
    const { app } = makeApp();
    const commitRes = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
    });
    const commitment = commitRes.json();

    const settleRes = await app.inject({
      method: "POST",
      url: `/rounds/${commitment.roundId}/settle`,
      payload: {
        stake: "0",
        clientSeed: "client-seed",
        nonce: 1,
        choice: { side: "heads" },
      },
    });
    expect(settleRes.statusCode).toBe(422);
  });

  it("410s a settlement past the round expiry", async () => {
    const { app, ledgerClient } = makeApp();
    const commitRes = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
    });
    const commitment = commitRes.json();

    ledgerClient.advance(100 + 999, "ledger-hash-far-future");

    const settleRes = await app.inject({
      method: "POST",
      url: `/rounds/${commitment.roundId}/settle`,
      payload: {
        stake: "100000000",
        clientSeed: "client-seed",
        nonce: 1,
        choice: { side: "heads" },
      },
    });
    expect(settleRes.statusCode).toBe(410);
  });
});

describe("API-key auth on the mutating endpoints (security-audit.md H1)", () => {
  it("401s /games/:gameId/commit with no key when apiKeys is configured", async () => {
    const { app } = makeAuthedApp(["secret-key"]);
    const res = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
    });
    expect(res.statusCode).toBe(401);
  });

  it("401s with a wrong key", async () => {
    const { app } = makeAuthedApp(["secret-key"]);
    const res = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
      headers: { "x-api-key": "wrong-key" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a correct key on commit and settle", async () => {
    const { app } = makeAuthedApp(["secret-key"]);
    const commitRes = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
      headers: { "x-api-key": "secret-key" },
    });
    expect(commitRes.statusCode).toBe(200);
    const commitment = commitRes.json();

    const settleRes = await app.inject({
      method: "POST",
      url: `/rounds/${commitment.roundId}/settle`,
      headers: { "x-api-key": "secret-key" },
      payload: {
        stake: "100000000",
        clientSeed: "client-seed",
        nonce: 1,
        choice: { side: "heads" },
      },
    });
    expect(settleRes.statusCode).toBe(200);
  });

  it("accepts any configured key when multiple are set", async () => {
    const { app } = makeAuthedApp(["key-one", "key-two"]);
    const res = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
      headers: { "x-api-key": "key-two" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("leaves /verify, /proofs/:id, and /audit/verify public even when apiKeys is configured", async () => {
    const { app } = makeAuthedApp(["secret-key"]);

    const commitRes = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
      headers: { "x-api-key": "secret-key" },
    });
    const commitment = commitRes.json();

    const proofRes = await app.inject({
      method: "GET",
      url: `/proofs/${commitment.roundId}`,
    });
    expect(proofRes.statusCode).toBe(404); // not settled, but reached the handler unauthenticated

    const auditRes = await app.inject({ method: "GET", url: "/audit/verify" });
    expect(auditRes.statusCode).toBe(200);
  });

  it("stays open (backward compatible) when apiKeys is empty", async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("rate limiting on the mutating endpoints (security-audit.md M1)", () => {
  it("429s after exceeding the configured per-IP ceiling", async () => {
    const { app } = makeAuthedApp(["secret-key"]);
    const headers = { "x-api-key": "secret-key" };

    const first = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
      headers,
    });
    const second = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
      headers,
    });
    const third = await app.inject({
      method: "POST",
      url: "/games/coin-flip/commit",
      headers,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
  });

  it("does not rate-limit /health, which has no per-route limit configured", async () => {
    const { app } = makeAuthedApp(["secret-key"]);
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    }
  });
});
