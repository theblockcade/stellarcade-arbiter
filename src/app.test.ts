import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { StaticLedgerClient } from "./ledger.js";
import { InMemoryRoundStore } from "./store-memory.js";

function makeApp() {
  const store = new InMemoryRoundStore();
  const ledgerClient = new StaticLedgerClient({ sequence: 100, hash: "ledger-hash-1" });
  const app = buildApp({ store, ledgerClient, maxPayout: 5000_0000000n, corsOrigin: "*" });
  return { app, store, ledgerClient };
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("round lifecycle over HTTP", () => {
  it("commits, settles, publishes a proof, and verifies it end to end", async () => {
    const { app } = makeApp();

    const commitRes = await app.inject({ method: "POST", url: "/games/coin-flip/commit" });
    expect(commitRes.statusCode).toBe(200);
    const commitment = commitRes.json();
    expect(commitment.commitHash).toMatch(/^[0-9a-f]{64}$/);

    const settleRes = await app.inject({
      method: "POST",
      url: `/rounds/${commitment.roundId}/settle`,
      payload: { stake: "100000000", clientSeed: "client-seed", nonce: 1, choice: { side: "heads" } },
    });
    expect(settleRes.statusCode).toBe(200);
    const settled = settleRes.json();
    expect(settled.roundId).toBe(commitment.roundId);

    const proofRes = await app.inject({ method: "GET", url: `/proofs/${commitment.roundId}` });
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
    const commitRes = await app.inject({ method: "POST", url: "/games/coin-flip/commit" });
    const commitment = commitRes.json();

    const proofRes = await app.inject({ method: "GET", url: `/proofs/${commitment.roundId}` });
    expect(proofRes.statusCode).toBe(404);
  });

  it("422s a settlement with a stake below policy minimum", async () => {
    const { app } = makeApp();
    const commitRes = await app.inject({ method: "POST", url: "/games/coin-flip/commit" });
    const commitment = commitRes.json();

    const settleRes = await app.inject({
      method: "POST",
      url: `/rounds/${commitment.roundId}/settle`,
      payload: { stake: "0", clientSeed: "client-seed", nonce: 1, choice: { side: "heads" } },
    });
    expect(settleRes.statusCode).toBe(422);
  });

  it("410s a settlement past the round expiry", async () => {
    const { app, ledgerClient } = makeApp();
    const commitRes = await app.inject({ method: "POST", url: "/games/coin-flip/commit" });
    const commitment = commitRes.json();

    ledgerClient.advance(100 + 999, "ledger-hash-far-future");

    const settleRes = await app.inject({
      method: "POST",
      url: `/rounds/${commitment.roundId}/settle`,
      payload: { stake: "100000000", clientSeed: "client-seed", nonce: 1, choice: { side: "heads" } },
    });
    expect(settleRes.statusCode).toBe(410);
  });
});
