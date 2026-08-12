import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
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
  /**
   * Keys accepted on `x-api-key` for /games/:gameId/commit and
   * /rounds/:roundId/settle — see docs/security-audit.md H1. Defaults to
   * an empty array (auth disabled), matching every existing test and local
   * dev flow that predates this; server.ts passes the real, validated list
   * from config.ts, which refuses to boot with an empty list in production.
   */
  apiKeys?: string[];
  /** Per-IP ceiling on the same two endpoints — security-audit.md M1. */
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
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
  const apiKeys = new Set(options.apiKeys ?? []);

  app.register(cors, { origin: options.corsOrigin });
  app.register(rateLimit, { global: false });

  // Auth only guards the two state-mutating routes (commit, settle) — see
  // BuildAppOptions.apiKeys. /verify, /proofs/:id, and /audit/verify stay
  // public: they're read-only proof-checking by design (security-audit.md
  // H1's own remediation note). Disabled entirely when apiKeys is empty,
  // which is every existing test and local-dev flow — server.ts is the only
  // caller that passes a real, non-empty list, and only once config.ts has
  // validated it (required in production).
  function requireApiKey(
    request: FastifyRequest,
    reply: FastifyReply,
    done: (err?: Error) => void,
  ) {
    if (apiKeys.size === 0) {
      done();
      return;
    }
    const provided = request.headers["x-api-key"];
    if (typeof provided === "string" && apiKeys.has(provided)) {
      done();
      return;
    }
    reply.code(401).send({ error: "Missing or invalid x-api-key." });
  }

  const mutatingRouteConfig = {
    preHandler: requireApiKey,
    config: {
      rateLimit: {
        max: options.rateLimitMax ?? 30,
        timeWindow: options.rateLimitWindowMs ?? 60_000,
      },
    },
  };

  app.get("/health", async () => ({ status: "ok" }));

  // `app.register()` above is deferred — it doesn't actually run until
  // avvio's boot phase, so the rate-limit plugin's `onRoute` hook isn't
  // attached yet at this point in buildApp()'s synchronous body. Routes
  // declared directly here would silently get no rate limiting at all
  // (confirmed: zero x-ratelimit-* headers, no error). `app.after()` defers
  // this callback until every plugin registered above has finished
  // loading, so the mutating routes below are the first ones the hook sees.
  app.after(() => {
    app.post<{ Body: CommitBody }>(
      "/games/:gameId/commit",
      mutatingRouteConfig,
      async (request, reply) => {
        const { gameId } = request.params as { gameId: string };
        const ledger = await options.ledgerClient.getCurrentLedger();
        const commitment = await beacon.commitRound({
          gameId,
          currentLedger: ledger.sequence,
        });
        return reply.send(commitment);
      },
    );

    app.post<{ Params: { roundId: string }; Body: SettleBody }>(
      "/rounds/:roundId/settle",
      mutatingRouteConfig,
      async (request, reply) => {
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
      },
    );
  });

  app.get<{ Params: { roundId: string } }>(
    "/proofs/:roundId",
    async (request, reply) => {
      try {
        const proof = await archive.getProof(request.params.roundId);
        return reply.send(proof);
      } catch (err) {
        if (err instanceof ProofNotAvailableError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

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
