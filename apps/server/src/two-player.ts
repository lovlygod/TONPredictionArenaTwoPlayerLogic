export type TwoPlayerVote = {
  tgUserId: string;
  optionId: string;
};

export type TwoPlayerResolution = {
  majority: string | null;
  eliminatedIds: string[];
};

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function resolveTwoPlayerRound(
  aliveIds: string[],
  optionIds: string[],
  votes: TwoPlayerVote[],
): TwoPlayerResolution {
  if (optionIds.length === 0) {
    return { majority: null, eliminatedIds: [] };
  }

  const serverChoice = pickRandom(optionIds);
  const matched = votes.filter((v) => v.optionId === serverChoice).map((v) => v.tgUserId);
  const uniqueMatched = Array.from(new Set(matched));

  if (uniqueMatched.length === 1) {
    const winnerId = uniqueMatched[0];
    return { majority: serverChoice, eliminatedIds: aliveIds.filter((id) => id !== winnerId) };
  }

  if (uniqueMatched.length === 2) {
    const winnerId = pickRandom(uniqueMatched);
    return { majority: serverChoice, eliminatedIds: aliveIds.filter((id) => id !== winnerId) };
  }

  const fallbackWinner = pickRandom(aliveIds);
  return { majority: serverChoice, eliminatedIds: aliveIds.filter((id) => id !== fallbackWinner) };
}
