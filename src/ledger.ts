export interface LedgerSnapshot {
  sequence: number;
  hash: string;
}

/**
 * Abstracts "what's the current Stellar ledger". Settlement uses this
 * rather than trusting a client-supplied ledger hash: the derivation input
 * (see entropy.ts) must come from the arbiter's own view of the chain, not
 * from the caller, or a client could shop around for a ledger hash that
 * favors their preferred outcome.
 */
export interface LedgerClient {
  getCurrentLedger(): Promise<LedgerSnapshot>;
}

interface HorizonLedgerResponse {
  _embedded: {
    records: Array<{ sequence: number; hash: string }>;
  };
}

export class HorizonLedgerClient implements LedgerClient {
  constructor(private readonly horizonUrl: string) {}

  async getCurrentLedger(): Promise<LedgerSnapshot> {
    const url = new URL("/ledgers", this.horizonUrl);
    url.searchParams.set("order", "desc");
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Horizon ledger lookup failed: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as HorizonLedgerResponse;
    const record = body._embedded.records[0];
    if (!record) {
      throw new Error("Horizon returned no ledger records");
    }
    return { sequence: record.sequence, hash: record.hash };
  }
}

/** Fixed-value client for tests and local dev without a live Horizon connection. */
export class StaticLedgerClient implements LedgerClient {
  constructor(private snapshot: LedgerSnapshot) {}

  async getCurrentLedger(): Promise<LedgerSnapshot> {
    return this.snapshot;
  }

  advance(sequence: number, hash: string): void {
    this.snapshot = { sequence, hash };
  }
}
