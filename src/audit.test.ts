import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "./audit.js";
import { InMemoryRoundStore } from "./store-memory.js";

describe("verifyAuditChain", () => {
  it("validates an empty chain", () => {
    expect(verifyAuditChain([])).toEqual({ valid: true });
  });

  it("validates a chain produced by the store", async () => {
    const store = new InMemoryRoundStore();
    await store.appendAudit("e1", { a: 1 });
    await store.appendAudit("e2", { b: 2 });
    await store.appendAudit("e3", { c: 3 });

    const entries = await store.listAudit();
    expect(verifyAuditChain(entries).valid).toBe(true);
  });

  it("detects a tampered data field", async () => {
    const store = new InMemoryRoundStore();
    await store.appendAudit("e1", { amount: 100 });
    await store.appendAudit("e2", { amount: 200 });

    const entries = await store.listAudit();
    entries[0]!.data = { amount: 999999 }; // tamper after the fact

    const result = verifyAuditChain(entries);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(1);
  });

  it("detects a reordered/deleted entry via a broken prevHash link", async () => {
    const store = new InMemoryRoundStore();
    await store.appendAudit("e1", {});
    await store.appendAudit("e2", {});
    await store.appendAudit("e3", {});

    const entries = await store.listAudit();
    const spliced = [entries[0]!, entries[2]!]; // drop the middle entry

    const result = verifyAuditChain(spliced);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
  });
});
