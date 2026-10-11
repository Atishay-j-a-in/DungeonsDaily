import type {
  AdventureState,
  DungeonMasterOutput,
  SessionDuration,
} from "@dungeonsdaily/shared";
import { EXERCISE_CATALOG } from "./exercises.js";
import {
  fallbackExercise,
  validateExerciseRequest,
} from "./exercise-engine.js";
import { levelForXp, xpForTurn } from "./progression.js";
import { sanitizeScene } from "./scene-engine.js";

export const VALID_DURATIONS: SessionDuration[] = [10, 20, 30];

export function assertValidDuration(value: unknown): asserts value is SessionDuration {
  if (value !== 10 && value !== 20 && value !== 30) {
    const err = new Error("Unsupported session duration") as Error & {
      code: string;
    };
    err.code = "INVALID_DURATION";
    throw err;
  }
}

const ADVENTURE_TITLES = [
  "The Forgotten Dungeon",
  "The Cursed Forest",
  "The Ember Caverns",
  "The Ruins of Dawn",
];

export function adventureTitleFor(sessionId: string): string {
  let hash = 0;
  for (const ch of sessionId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ADVENTURE_TITLES[hash % ADVENTURE_TITLES.length]!;
}

export function createInitialState(input: {
  sessionId: string;
  userId: string;
  durationMinutes: SessionDuration;
  now?: Date;
}): AdventureState {
  return {
    sessionId: input.sessionId,
    userId: input.userId,
    durationMinutes: input.durationMinutes,
    status: "active",
    chapter: 1,
    scene: "dungeon",
    player: { xp: 0, health: 100, level: 1 },
    currentExercise: undefined,
    completedExercises: [],
    turnNumber: 0,
    startedAt: input.now ?? new Date(),
    updatedAt: input.now ?? new Date(),
  };
}

export type AppliedTurn = {
  narration: string;
  mood: DungeonMasterOutput["mood"];
  scene: DungeonMasterOutput["scene"];
  action: DungeonMasterOutput["action"];
  responseExpectation: DungeonMasterOutput["responseExpectation"];
  xpAwarded: number;
};

/**
 * Authoritative state transition. Never trusts the LLM blindly:
 * validates exercise + audio cues, clamps XP/health, then mutates state.
 */
export function applyDungeonMasterOutput(
  state: AdventureState,
  output: DungeonMasterOutput,
): AppliedTurn {
  const scene = sanitizeScene({
    environment: output.scene.environment,
    ambientSounds: output.scene.ambientSounds,
    soundEffects: output.scene.soundEffects,
    music: output.scene.music,
  });

  let action = output.action;
  if (action.type === "exercise") {
    const check = validateExerciseRequest({
      exerciseId: action.exerciseId,
      reps: action.reps,
      durationSeconds: action.durationSeconds,
    });
    if (!check.ok) {
      const fb = fallbackExercise(state.completedExercises);
      action = {
        type: "exercise",
        prompt: `Steel yourself — complete ${fb.reps ?? fb.durationSeconds} ${fb.exerciseId.replace(/_/g, " ")}.`,
        ...fb,
      };
    }
  }

  const xpAwarded = xpForTurn(output.stateChanges.xp);
  const nextXp = state.player.xp + xpAwarded;
  const nextHealth = Math.max(
    0,
    Math.min(100, state.player.health + output.stateChanges.healthDelta),
  );

  state.player.xp = nextXp;
  state.player.health = nextHealth;
  state.player.level = levelForXp(nextXp);
  state.scene = scene.environment;
  state.turnNumber += 1;
  state.updatedAt = new Date();

  if (action.type === "exercise" && action.exerciseId) {
    state.currentExercise = {
      exerciseId: action.exerciseId,
      ...(action.reps ? { reps: action.reps } : {}),
      ...(action.durationSeconds
        ? { durationSeconds: action.durationSeconds }
        : {}),
      completed: false,
    };
  }
  if (action.type === "complete") {
    state.status = "completed";
  }

  return {
    narration: output.narration,
    mood: output.mood,
    scene,
    action,
    responseExpectation: output.responseExpectation,
    xpAwarded,
  };
}

export function completeCurrentExercise(
  state: AdventureState,
  exerciseId: string,
): { reps?: number; durationSeconds?: number } {
  if (!state.currentExercise || state.currentExercise.completed) {
    const err = new Error("No active exercise") as Error & { code: string };
    err.code = "INVALID_EXERCISE";
    throw err;
  }
  if (state.currentExercise.exerciseId !== exerciseId) {
    const err = new Error("Exercise does not match current challenge") as Error & {
      code: string;
    };
    err.code = "INVALID_EXERCISE";
    throw err;
  }
  state.currentExercise.completed = true;
  state.completedExercises.push(exerciseId);
  state.updatedAt = new Date();
  return {
    ...(state.currentExercise.reps ? { reps: state.currentExercise.reps } : {}),
    ...(state.currentExercise.durationSeconds
      ? { durationSeconds: state.currentExercise.durationSeconds }
      : {}),
  };
}

export function exerciseCatalogForPrompt() {
  return EXERCISE_CATALOG;
}
