import { mapToRange } from "./entropy.js";

export interface ResolveResult {
  outcome: unknown;
  payout: bigint;
}

export type Resolver = (derivedValue: bigint, stake: bigint, choice: unknown) => ResolveResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const coinFlip: Resolver = (derivedValue, stake, choice) => {
  const roll = mapToRange(derivedValue, 2);
  const side = roll === 0 ? "heads" : "tails";
  const called = isRecord(choice) && (choice.side === "heads" || choice.side === "tails") ? choice.side : null;
  const won = called !== null && called === side;
  return { outcome: { side, won }, payout: won ? stake * 2n : 0n };
};

const diceRoll: Resolver = (derivedValue, stake, choice) => {
  const roll = mapToRange(derivedValue, 6) + 1;
  const called = isRecord(choice) && typeof choice.number === "number" ? choice.number : null;
  const won = called !== null && called === roll;
  return { outcome: { roll, won }, payout: won ? stake * 6n : 0n };
};

const higherLower: Resolver = (derivedValue, stake, choice) => {
  const roll = mapToRange(derivedValue, 100) + 1;
  const baseline = isRecord(choice) && typeof choice.baseline === "number" ? choice.baseline : 50;
  const called = isRecord(choice) && (choice.call === "higher" || choice.call === "lower") ? choice.call : null;
  const isHigher = roll > baseline;
  const won = called !== null && ((called === "higher" && isHigher) || (called === "lower" && !isHigher));
  return { outcome: { roll, baseline, won }, payout: won ? (stake * 19n) / 10n : 0n };
};

const numberGuess: Resolver = (derivedValue, stake, choice) => {
  const roll = mapToRange(derivedValue, 100) + 1;
  const called = isRecord(choice) && typeof choice.number === "number" ? choice.number : null;
  const won = called !== null && called === roll;
  return { outcome: { roll, won }, payout: won ? stake * 90n : 0n };
};

const RESOLVERS: Record<string, Resolver> = {
  "coin-flip": coinFlip,
  "dice-roll": diceRoll,
  "higher-lower": higherLower,
  "number-guess": numberGuess,
};

export function resolverFor(gameId: string): Resolver {
  const resolver = RESOLVERS[gameId];
  if (!resolver) {
    throw new Error(`No resolver registered for game "${gameId}"`);
  }
  return resolver;
}
