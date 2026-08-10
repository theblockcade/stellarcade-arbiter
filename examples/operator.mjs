#!/usr/bin/env node
// Operator-side demo: check health, verify the audit chain, replay a proof
// fetched from disk (useful for offline dispute investigation).
// Usage: node examples/operator.mjs [path/to/proof.json]

const BASE_URL = process.env.ARBITER_URL ?? "http://localhost:4100";

async function main() {
  const health = await getJson(`${BASE_URL}/health`);
  console.log("Health:", health);

  const audit = await getJson(`${BASE_URL}/audit/verify`);
  console.log("Audit chain valid:", audit.valid, audit.valid ? "" : `(broke at seq ${audit.brokenAtSeq}: ${audit.reason})`);

  const proofPath = process.argv[2];
  if (!proofPath) {
    console.log("\nNo proof file given — skipping replay. Usage: node examples/operator.mjs <proof.json>");
    return;
  }

  const { readFile } = await import("node:fs/promises");
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  const stake = process.argv[3] ?? "100000000";

  const verification = await postJson(`${BASE_URL}/verify`, { proof, stake });
  console.log("\nReplay of", proofPath, ":", verification);
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
