// Safety + validity rules (guide §8). The game engine is authoritative.

import { EXERCISE_CATALOG, findExercise } from "./exercises.js";

export const MAX_REPS = 30;
export const MAX_DURATION_SECONDS = 120;

export type ExerciseValidation =
  | { ok: true }
  | { ok: false; reason: string };

export function validateExerciseRequest(input: {
  exerciseId?: string;
  reps?: number;
  durationSeconds?: number;
}): ExerciseValidation {
  if (!input.exerciseId) return { ok: false, reason: "missing exerciseId" };
  const exercise = findExercise(input.exerciseId);
  if (!exercise) return { ok: false, reason: `unknown exercise: ${input.exerciseId}` };
  if (input.reps !== undefined && (!Number.isInteger(input.reps) || input.reps < 1 || input.reps > MAX_REPS)) {
    return { ok: false, reason: `reps out of range 1..${MAX_REPS}` };
  }
  if (
    input.durationSeconds !== undefined &&
    (!Number.isInteger(input.durationSeconds) ||
      input.durationSeconds < 5 ||
      input.durationSeconds > MAX_DURATION_SECONDS)
  ) {
    return { ok: false, reason: `durationSeconds out of range 5..${MAX_DURATION_SECONDS}` };
  }
  return { ok: true };
}

/** Deterministic replacement when the LLM requests something invalid. */
export function fallbackExercise(completedIds: string[] = []): {
  exerciseId: string;
  reps?: number;
  durationSeconds?: number;
} {
  const candidate =
    EXERCISE_CATALOG.find((e) => !completedIds.includes(e.id)) ??
    EXERCISE_CATALOG[0]!;
  return {
    exerciseId: candidate.id,
    ...(candidate.defaultReps ? { reps: candidate.defaultReps } : {}),
    ...(candidate.defaultDurationSeconds
      ? { durationSeconds: candidate.defaultDurationSeconds }
      : {}),
  };
}
