import { Pool } from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { HorizonLedgerClient } from "./ledger.js";
import { InMemoryRoundStore } from "./store-memory.js";
import { PostgresRoundStore } from "./store-postgres.js";
import type { RoundStore } from "./store.js";

async function main(): Promise<void> {
  const config = loadConfig();

  let store: RoundStore;
  if (config.databaseUrl) {
    const pool = new Pool({ connectionString: config.databaseUrl });
    store = new PostgresRoundStore(pool);
  } else {
    // loadConfig() already refused to reach here without a databaseUrl
    // outside development/test — this branch is dev-only by construction.
    store = new InMemoryRoundStore();
  }

  const ledgerClient = new HorizonLedgerClient(deriveHorizonUrl(config.rpcUrl));

  const app = buildApp({
    store,
    ledgerClient,
    maxPayout: config.maxPayout,
    corsOrigin: config.corsOrigin,
    logger: true,
    apiKeys: config.apiKeys,
    rateLimitMax: config.rateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

/**
 * The arbiter is configured with an RPC URL (Soroban) but ledger lookups
 * use Horizon. For the well-known testnet/mainnet RPC hosts this derives
 * the matching Horizon host; for anything else (local, custom) set
 * HORIZON_URL explicitly.
 */
function deriveHorizonUrl(rpcUrl: string): string {
  const explicit = process.env.HORIZON_URL;
  if (explicit) return explicit;

  if (rpcUrl.includes("soroban-testnet"))
    return "https://horizon-testnet.stellar.org";
  if (rpcUrl.includes("mainnet.sorobanrpc.com"))
    return "https://horizon.stellar.org";
  if (rpcUrl.includes("futurenet"))
    return "https://horizon-futurenet.stellar.org";

  throw new Error(
    `Could not derive a Horizon URL from STELLAR_RPC_URL="${rpcUrl}". Set HORIZON_URL explicitly.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
