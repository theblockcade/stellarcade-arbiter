export type Network = "testnet" | "mainnet" | "futurenet" | "local";

const NETWORK_PASSPHRASES: Record<Network, string> = {
  mainnet: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
  local: "Standalone Network ; February 2017",
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ArbiterConfig {
  port: number;
  network: Network;
  networkPassphrase: string;
  rpcUrl: string;
  databaseUrl: string | undefined;
  nodeEnv: "development" | "test" | "production";
  corsOrigin: string;
  /** Above this stake, a round requires additional policy review before settling. */
  maxAutoSettleStake: bigint;
  /** Global per-round payout ceiling — enforced by policy.ts regardless of pool balance. */
  maxPayout: bigint;
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Loads and validates arbiter config from environment variables.
 *
 * `STELLAR_NETWORK` is the explicit network signal — there is no default,
 * and it is cross-checked against `STELLAR_NETWORK_PASSPHRASE`. A misconfig
 * here would mean the arbiter derives outcomes and authorizes payouts
 * against the wrong ledger, so this fails loudly at boot rather than
 * quietly limping along on a mismatched pair.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ArbiterConfig {
  const networkRaw = requireEnv(env, "STELLAR_NETWORK");
  if (!isNetwork(networkRaw)) {
    throw new ConfigError(
      `STELLAR_NETWORK must be one of testnet|mainnet|futurenet|local, got "${networkRaw}"`,
    );
  }
  const network = networkRaw;

  const networkPassphrase = env.STELLAR_NETWORK_PASSPHRASE ?? NETWORK_PASSPHRASES[network];
  if (networkPassphrase !== NETWORK_PASSPHRASES[network]) {
    throw new ConfigError(
      `STELLAR_NETWORK_PASSPHRASE does not match STELLAR_NETWORK="${network}". ` +
        `Expected "${NETWORK_PASSPHRASES[network]}", got "${networkPassphrase}". Refusing to boot.`,
    );
  }

  const rpcUrl = requireEnv(env, "STELLAR_RPC_URL");
  const nodeEnv = (env.NODE_ENV as ArbiterConfig["nodeEnv"]) ?? "development";
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl && nodeEnv !== "development" && nodeEnv !== "test") {
    throw new ConfigError(
      `DATABASE_URL is required outside development/test (NODE_ENV="${nodeEnv}"). ` +
        `The arbiter never silently falls back to in-memory storage in production — ` +
        `an unreachable database must be a startup failure, not a quiet degrade.`,
    );
  }

  const corsOrigin = env.CORS_ORIGIN ?? "*";
  if (corsOrigin === "*" && nodeEnv === "production") {
    throw new ConfigError(
      `CORS_ORIGIN must be set to a real origin in production — refusing the "*" default ` +
        `(security-audit.md M2). Set CORS_ORIGIN explicitly to your frontend's origin.`,
    );
  }

  return {
    port: Number(env.PORT ?? 4100),
    network,
    networkPassphrase,
    rpcUrl,
    databaseUrl,
    nodeEnv,
    corsOrigin,
    maxAutoSettleStake: parsePositiveBigInt(env, "MAX_AUTO_SETTLE_STAKE", "10000000000"), // 1000.0000000 (7dp)
    maxPayout: parsePositiveBigInt(env, "MAX_PAYOUT", "50000000000"), // 5000.0000000 (7dp)
  };
}

function isNetwork(value: string): value is Network {
  return value === "testnet" || value === "mainnet" || value === "futurenet" || value === "local";
}

function parsePositiveBigInt(env: NodeJS.ProcessEnv, key: string, fallback: string): bigint {
  const raw = env[key] ?? fallback;
  if (!/^[0-9]+$/.test(raw)) {
    throw new ConfigError(`${key} must be a non-negative integer string, got "${raw}"`);
  }
  return BigInt(raw);
}
