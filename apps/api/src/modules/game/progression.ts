// XP + level math. Deterministic and independently testable.

export function xpForExercise(input: {
  reps?: number;
  durationSeconds?: number;
}): number {
  if (input.reps) return Math.min(60, 10 + input.reps);
  if (input.durationSeconds) return Math.min(60, 10 + Math.floor(input.durationSeconds / 2));
  return 10;
}

export function xpForTurn(baseXp: number): number {
  if (!Number.isFinite(baseXp)) return 0;
  return Math.max(0, Math.min(100, Math.floor(baseXp)));
}

/** Level 1 starts at 0 XP; every 100 XP = +1 level. */
export function levelForXp(totalXp: number): number {
  return 1 + Math.floor(Math.max(0, totalXp) / 100);
}
