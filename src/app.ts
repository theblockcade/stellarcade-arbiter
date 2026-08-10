import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { Beacon, RoundExpiredError } from "./beacon.js";
import type { LedgerClient } from "./ledger.js";
import { PolicyViolationError, CircuitBreaker } from "./policy.js";
import { ProofArchive, ProofNotAvailableError } from "./proofs.js";
import { replayRound } from "./dispute.js";
import { verifyStoredAuditChain } from "./audit.js";
import { Settler } from "./settle.js";
import type { RoundStore } from "./store.js";

export interface BuildAppOptions {
  store: RoundStore;
  ledgerClient: LedgerClient;
  maxPayout: bigint;
  corsOrigin: string;
  circuitBreaker?: CircuitBreaker;
  /**
   * Fastify's pino logger. Defaults to off — its transport thread spin-up
   * adds latency that's wasted in tests and library use. server.ts enables
   * it explicitly for the real, listening process.
   */
  logger?: boolean;
}

interface CommitBody {
  gameId: string;
}

interface SettleBody {
  stake: string;
  clientSeed: string;
  nonce: number;
  choice: unknown;
}

interface VerifyBody {
  proof: {
    roundId: string;
    gameId: string;
    commitHash: string;
    serverSeed: string;
    clientSeed: string;
    nonce: number;
    ledgerHash: string;
    derivedValue: string;
    outcome: unknown;
  };
  stake: string;
}

/**
 * Builds the fastify instance without starting it — kept separate from
 * server.ts so tests can exercise routes via `app.inject()` without binding
 * a real port.
 */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const beacon = new Beacon(options.store);
  const circuitBreaker = options.circuitBreaker ?? new CircuitBreaker();
  const settler = new Settler(options.store, options.maxPayout, circuitBreaker);
  const archive = new ProofArchive(options.store);

  app.register(cors, { origin: options.corsOrigin });

  app.get("/health", async () => ({ status: "ok" }));

  app.post<{ Body: CommitBody }>("/games/:gameId/commit", async (request, reply) => {
    const { gameId } = request.params as { gameId: string };
    const ledger = await options.ledgerClient.getCurrentLedger();
    const commitment = await beacon.commitRound({ gameId, currentLedger: ledger.sequence });
    return reply.send(commitment);
  });

  app.post<{ Params: { roundId: string }; Body: SettleBody }>("/rounds/:roundId/settle", async (request, reply) => {
    const { roundId } = request.params;
    const { stake, clientSeed, nonce, choice } = request.body;

    try {
      const ledger = await options.ledgerClient.getCurrentLedger();
      const result = await settler.settle({
        roundId,
        stake: BigInt(stake),
        clientSeed,
        nonce,
        ledgerHash: ledger.hash,
        choice,
        currentLedger: ledger.sequence,
      });
      return reply.send({
        roundId: result.roundId,
        outcome: result.outcome,
        payout: result.payout.toString(),
        derivedValue: result.derivedValue,
      });
    } catch (err) {
      if (err instanceof RoundExpiredError) {
        return reply.code(410).send({ error: err.message });
      }
      if (err instanceof PolicyViolationError) {
        return reply.code(422).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  app.get<{ Params: { roundId: string } }>("/proofs/:roundId", async (request, reply) => {
    try {
      const proof = await archive.getProof(request.params.roundId);
      return reply.send(proof);
    } catch (err) {
      if (err instanceof ProofNotAvailableError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Body: VerifyBody }>("/verify", async (request, reply) => {
    const { proof, stake } = request.body;
    const result = replayRound(proof, BigInt(stake));
    return reply.send(result);
  });

  app.get("/audit/verify", async (_request, reply) => {
    const result = await verifyStoredAuditChain(options.store);
    return reply.send(result);
  });

  return app;
}
