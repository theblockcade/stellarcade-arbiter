/**
 * VRF (Verifiable Random Function) support — NOT YET IMPLEMENTED.
 *
 * The commit-reveal scheme in beacon.ts/entropy.ts is what actually runs
 * today. It is fair (see docs/fairness-spec.md) but requires the reveal
 * step: an observer cannot verify anything until the arbiter publishes the
 * server seed. A VRF would let the arbiter prove, ledger-hash-only, that a
 * value it publishes *before* reveal was generated correctly — no trust in
 * "the arbiter will reveal honestly later" required.
 *
 * This module defines the interface that a real VRF implementation
 * (elliptic-curve based, e.g. RFC 9381) would fill in, and the on-chain
 * verification hook a future `random-generator` contract would call. Ship
 * this dishonestly-labeled as "done" and you get exactly the kind of gap
 * documented against Vellar's `observability.md` — a doc describing
 * something the code doesn't do. Don't do that here.
 */

export interface VrfProof {
  publicKey: string;
  input: string;
  output: string;
  proof: string;
}

export interface VrfProvider {
  /** Deterministically derives an output + proof from `input` using the provider's secret key. */
  prove(input: string): Promise<VrfProof>;
  /** Verifies that `proof.output` was correctly derived from `proof.input` under `proof.publicKey`. */
  verify(proof: VrfProof): Promise<boolean>;
}

export class VrfNotImplementedError extends Error {
  constructor() {
    super(
      "VRF support is not implemented. The arbiter currently uses commit-reveal " +
        "(see beacon.ts, entropy.ts) — see this file's module comment for the gap " +
        "a real VRF would close.",
    );
    this.name = "VrfNotImplementedError";
  }
}

export class UnimplementedVrfProvider implements VrfProvider {
  async prove(_input: string): Promise<VrfProof> {
    throw new VrfNotImplementedError();
  }

  async verify(_proof: VrfProof): Promise<boolean> {
    throw new VrfNotImplementedError();
  }
}
