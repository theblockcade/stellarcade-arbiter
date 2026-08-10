#!/usr/bin/env node
// Minimal end-to-end demo: commit -> settle -> fetch proof -> verify.
// Run against a local `npm run dev` instance: node examples/player.mjs

const BASE_URL = process.env.ARBITER_URL ?? "http://localhost:4100";

async function main() {
  const commit = await postJson(`${BASE_URL}/games/coin-flip/commit`, {});
  console.log("Committed round:", commit.roundId, "commitHash:", commit.commitHash);

  const settled = await postJson(`${BASE_URL}/rounds/${commit.roundId}/settle`, {
    stake: "100000000", // 10.0000000
    clientSeed: cryptoRandomHex(),
    nonce: 1,
    choice: { side: "heads" },
  });
  console.log("Settled:", settled.outcome, "payout:", settled.payout);

  const proof = await getJson(`${BASE_URL}/proofs/${commit.roundId}`);
  console.log("Proof:", proof);

  const verification = await postJson(`${BASE_URL}/verify`, { proof, stake: "100000000" });
  console.log("Independently reproducible:", verification.reproducible);
}

function cryptoRandomHex() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
