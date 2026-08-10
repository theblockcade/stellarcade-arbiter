import { afterEach, describe, expect, it, vi } from "vitest";
import { HorizonLedgerClient, StaticLedgerClient } from "./ledger.js";

describe("StaticLedgerClient", () => {
  it("returns the fixed snapshot", async () => {
    const client = new StaticLedgerClient({ sequence: 100, hash: "abc" });
    expect(await client.getCurrentLedger()).toEqual({ sequence: 100, hash: "abc" });
  });

  it("returns an updated snapshot after advance()", async () => {
    const client = new StaticLedgerClient({ sequence: 100, hash: "abc" });
    client.advance(200, "def");
    expect(await client.getCurrentLedger()).toEqual({ sequence: 200, hash: "def" });
  });
});

describe("HorizonLedgerClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses the latest ledger from Horizon's response shape", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ _embedded: { records: [{ sequence: 12345, hash: "ledgerhash123" }] } }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const client = new HorizonLedgerClient("https://horizon-testnet.stellar.org");
    const snapshot = await client.getCurrentLedger();
    expect(snapshot).toEqual({ sequence: 12345, hash: "ledgerhash123" });
  });

  it("throws when Horizon returns a non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("", { status: 503 })) as unknown as typeof fetch;

    const client = new HorizonLedgerClient("https://horizon-testnet.stellar.org");
    await expect(client.getCurrentLedger()).rejects.toThrow(/503/);
  });

  it("throws when Horizon returns no records", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ _embedded: { records: [] } }), { status: 200 }),
    ) as unknown as typeof fetch;

    const client = new HorizonLedgerClient("https://horizon-testnet.stellar.org");
    await expect(client.getCurrentLedger()).rejects.toThrow(/no ledger records/);
  });
});
