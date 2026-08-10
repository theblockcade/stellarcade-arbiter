import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

function baseEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    STELLAR_NETWORK: "testnet",
    STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    NODE_ENV: "test",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("loadConfig", () => {
  it("loads a valid testnet config", () => {
    const config = loadConfig(baseEnv());
    expect(config.network).toBe("testnet");
    expect(config.networkPassphrase).toContain("Test SDF Network");
  });

  it("throws when STELLAR_NETWORK is missing", () => {
    const env = baseEnv();
    delete env.STELLAR_NETWORK;
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it("throws when STELLAR_NETWORK is not a recognized value", () => {
    expect(() => loadConfig(baseEnv({ STELLAR_NETWORK: "devnet" }))).toThrow(ConfigError);
  });

  it("throws when the passphrase does not match the network", () => {
    expect(() =>
      loadConfig(
        baseEnv({
          STELLAR_NETWORK: "mainnet",
          STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
        }),
      ),
    ).toThrow(/does not match/);
  });

  it("throws when STELLAR_RPC_URL is missing", () => {
    const env = baseEnv();
    delete env.STELLAR_RPC_URL;
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it("requires DATABASE_URL outside development/test", () => {
    expect(() => loadConfig(baseEnv({ NODE_ENV: "production" }))).toThrow(/DATABASE_URL is required/);
  });

  it("allows missing DATABASE_URL in development", () => {
    expect(() => loadConfig(baseEnv({ NODE_ENV: "development" }))).not.toThrow();
  });

  it("accepts DATABASE_URL and an explicit CORS_ORIGIN in production", () => {
    const config = loadConfig(
      baseEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@host:5432/db",
        CORS_ORIGIN: "https://theblockcade.xyz",
      }),
    );
    expect(config.databaseUrl).toBe("postgres://user:pass@host:5432/db");
    expect(config.corsOrigin).toBe("https://theblockcade.xyz");
  });

  it("rejects a wildcard CORS_ORIGIN in production", () => {
    expect(() =>
      loadConfig(
        baseEnv({
          NODE_ENV: "production",
          DATABASE_URL: "postgres://user:pass@host:5432/db",
        }),
      ),
    ).toThrow(/CORS_ORIGIN must be set/);
  });

  it("allows the wildcard CORS_ORIGIN default outside production", () => {
    const config = loadConfig(baseEnv());
    expect(config.corsOrigin).toBe("*");
  });

  it("rejects a non-numeric MAX_PAYOUT", () => {
    expect(() => loadConfig(baseEnv({ MAX_PAYOUT: "not-a-number" }))).toThrow(/must be a non-negative integer/);
  });

  it("accepts a numeric MAX_AUTO_SETTLE_STAKE override", () => {
    const config = loadConfig(baseEnv({ MAX_AUTO_SETTLE_STAKE: "42" }));
    expect(config.maxAutoSettleStake).toBe(42n);
  });
});
