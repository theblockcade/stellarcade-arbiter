export class PolicyViolationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

export interface GameLimits {
  minStake: bigint;
  maxStake: bigint;
  maxPayoutMultiplier: number;
}

const DEFAULT_LIMITS: GameLimits = {
  minStake: 1_0000000n, // 1.0000000
  maxStake: 500_0000000n, // 500.0000000
  maxPayoutMultiplier: 20,
};

const GAME_LIMITS: Record<string, GameLimits> = {
  "coin-flip": DEFAULT_LIMITS,
  "dice-roll": DEFAULT_LIMITS,
  "higher-lower": DEFAULT_LIMITS,
  "number-guess": { ...DEFAULT_LIMITS, maxPayoutMultiplier: 90 },
  trivia: { ...DEFAULT_LIMITS, maxStake: 100_0000000n },
};

export function limitsFor(gameId: string): GameLimits {
  return GAME_LIMITS[gameId] ?? DEFAULT_LIMITS;
}

export function assertStakeAllowed(gameId: string, stake: bigint): void {
  const limits = limitsFor(gameId);
  if (stake < limits.minStake) {
    throw new PolicyViolationError(
      `Stake ${stake} is below the minimum ${limits.minStake} for game "${gameId}"`,
      "STAKE_TOO_LOW",
    );
  }
  if (stake > limits.maxStake) {
    throw new PolicyViolationError(
      `Stake ${stake} exceeds the maximum ${limits.maxStake} for game "${gameId}"`,
      "STAKE_TOO_HIGH",
    );
  }
}

export function assertPayoutAllowed(gameId: string, stake: bigint, payout: bigint, maxPayout: bigint): void {
  const limits = limitsFor(gameId);
  const cap = stake * BigInt(limits.maxPayoutMultiplier);
  if (payout > cap) {
    throw new PolicyViolationError(
      `Payout ${payout} exceeds ${limits.maxPayoutMultiplier}x stake cap (${cap}) for game "${gameId}"`,
      "PAYOUT_EXCEEDS_MULTIPLIER",
    );
  }
  if (payout > maxPayout) {
    throw new PolicyViolationError(
      `Payout ${payout} exceeds the global max payout ${maxPayout}`,
      "PAYOUT_EXCEEDS_GLOBAL_MAX",
    );
  }
}

/**
 * A minimal circuit breaker: once tripped, `assertClosed()` throws for every
 * caller until explicitly reset. Intended to be tripped by an operator (or
 * an automated anomaly detector, in a later iteration — see
 * docs/operator-runbook.md) when something looks wrong, e.g. an
 * implausible run of payouts.
 */
export class CircuitBreaker {
  private open = false;
  private reason: string | null = null;

  trip(reason: string): void {
    this.open = true;
    this.reason = reason;
  }

  reset(): void {
    this.open = false;
    this.reason = null;
  }

  isOpen(): boolean {
    return this.open;
  }

  assertClosed(): void {
    if (this.open) {
      throw new PolicyViolationError(
        `Circuit breaker is open${this.reason ? `: ${this.reason}` : ""}. Settlement is paused.`,
        "CIRCUIT_OPEN",
      );
    }
  }
}
