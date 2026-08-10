# Fairness Spec

The exact algorithm, byte for byte. This document and `src/entropy.ts` must
never drift from each other or from `stellarcade-sdk/src/fairness.ts` — if
they do, published proofs stop verifying.

## Commitment

```
serverSeed = random 32 bytes, hex-encoded (64 hex chars)
commitHash = sha256(serverSeed)   // hex-encoded
```

`commitHash` is published in `POST /games/:gameId/commit`'s response,
**before** any stake exists for the round. `serverSeed` stays in the
database, unreadable via any endpoint, until settlement.

## Derivation

```
material     = `${serverSeed}:${clientSeed}:${nonce}:${ledgerHash}`
derivedValue = BigInt("0x" + sha256(material))   // hex digest interpreted as a 256-bit integer
```

- `clientSeed` — chosen by the player before the round, before they know the
  server seed or the ledger hash.
- `nonce` — supplied by the caller; distinguishes otherwise-identical
  settle requests.
- `ledgerHash` — the Stellar ledger hash at settlement time, fetched by the
  arbiter itself via `LedgerClient` (see `src/ledger.ts`), never trusted from
  the caller.

No party controls all four inputs, and the server seed's hash was fixed
before any of the other three were known.

## Mapping to a bounded outcome

```
mapToRange(value, size) = Number(value % BigInt(size))
```

Used per-game in `src/resolvers.ts`, e.g. `mapToRange(derivedValue, 2)` for
coin-flip, `mapToRange(derivedValue, 6) + 1` for a six-sided die.

## What verification proves

Given a `FairnessProof` (roundId, commitHash, serverSeed, clientSeed, nonce,
ledgerHash, derivedValue, outcome):

1. **`sha256(serverSeed) == commitHash`** — the revealed seed matches what
   was committed before the bet. If this fails, the arbiter could have
   picked a different seed after seeing the bet.
2. **`deriveOutcomeValue(...) == derivedValue`** — the published derived
   value was actually computed from the revealed seed material. If this
   fails, the outcome wasn't really derived the way it's claimed to be.

Both checks run entirely offline, on `Web Crypto` (SDK) or `node:crypto`
(arbiter, `src/dispute.ts`). Reimplementing them in another language is
about ten lines of SHA-256.

## What this does NOT prove

- That the payout amount matches the outcome — enforced on-chain by the
  `prize-pool` contract, not by this scheme.
- That the arbiter will always publish a proof promptly — it can (and the
  audit log will show a gap), but nothing here prevents delay. See
  [security-audit.md](security-audit.md) for the honest limitations list.
- Anything about randomness quality beyond SHA-256's properties as a hash
  function — this is commit-reveal, not a formal VRF. See
  [`../src/vrf.ts`](../src/vrf.ts) for the documented gap a real VRF would
  close.
