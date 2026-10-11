import { describe, expect, it } from "vitest";
import {
  applyDungeonMasterOutput,
  assertValidDuration,
  completeCurrentExercise,
  createInitialState,
} from "../src/modules/game/game-engine.js";
import {
  fallbackExercise,
  validateExerciseRequest,
} from "../src/modules/game/exercise-engine.js";
import { levelForXp, xpForExercise } from "../src/modules/game/progression.js";
import type { DungeonMasterOutput } from "@dungeonsdaily/shared";

describe("durations", () => {
  it("accepts 10/20/30", () => {
    expect(() => assertValidDuration(10)).not.toThrow();
    expect(() => assertValidDuration(20)).not.toThrow();
    expect(() => assertValidDuration(30)).not.toThrow();
  });
  it("rejects anything else", () => {
    expect(() => assertValidDuration(15)).toThrowError(/duration/i);
    expect(() => assertValidDuration("20")).toThrow();
  });
});

describe("exercises", () => {
  it("accepts a valid exercise", () => {
    expect(
      validateExerciseRequest({ exerciseId: "squats", reps: 10 }),
    ).toEqual({ ok: true });
  });
  it("rejects unknown ids and unsafe ranges", () => {
    expect(validateExerciseRequest({ exerciseId: "deadlift_500kg" }).ok).toBe(false);
    expect(validateExerciseRequest({ exerciseId: "squats", reps: 99 }).ok).toBe(false);
    expect(
      validateExerciseRequest({ exerciseId: "plank", durationSeconds: 999 }).ok,
    ).toBe(false);
  });
  it("falls back deterministically", () => {
    const fb = fallbackExercise([]);
    expect(fb.exerciseId).toBeTruthy();
  });
});

describe("progression", () => {
  it("computes xp and levels", () => {
    expect(xpForExercise({ reps: 10 })).toBeGreaterThan(0);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(250)).toBe(3);
  });
});

describe("game engine", () => {
  function validOutput(): DungeonMasterOutput {
    return {
      narration: "A wolf steps from the shadows.",
      mood: "danger",
      scene: {
        environment: "forest",
        ambientSounds: ["wind"],
        soundEffects: ["wolf_growl"],
      },
      action: {
        type: "exercise",
        exerciseId: "squats",
        reps: 10,
        prompt: "Defeat the wolf with ten powerful squats.",
      },
      responseExpectation: "exercise_completion",
      stateChanges: { xp: 20, healthDelta: 0 },
    };
  }

  it("applies a valid DM turn and assigns the exercise", () => {
    const state = createInitialState({
      sessionId: "s1",
      userId: "u1",
      durationMinutes: 10,
    });
    const applied = applyDungeonMasterOutput(state, validOutput());
    expect(applied.xpAwarded).toBe(20);
    expect(state.player.xp).toBe(20);
    expect(state.currentExercise?.exerciseId).toBe("squats");
  });

  it("replaces an invalid exercise with a deterministic one", () => {
    const state = createInitialState({
      sessionId: "s1",
      userId: "u1",
      durationMinutes: 10,
    });
    const bad = validOutput();
    bad.action.exerciseId = "invented_by_llm";
    const applied = applyDungeonMasterOutput(state, bad);
    expect(applied.action.exerciseId).not.toBe("invented_by_llm");
    expect(state.currentExercise?.exerciseId).toBeTruthy();
  });

  it("completes the current exercise only when ids match", () => {
    const state = createInitialState({
      sessionId: "s1",
      userId: "u1",
      durationMinutes: 10,
    });
    applyDungeonMasterOutput(state, validOutput());
    expect(() => completeCurrentExercise(state, "plank")).toThrow();
    expect(() => completeCurrentExercise(state, "squats")).not.toThrow();
    expect(state.completedExercises).toContain("squats");
  });

  it("never lets Gemma set XP/health directly (engine clamps)", () => {
    const state = createInitialState({
      sessionId: "s1",
      userId: "u1",
      durationMinutes: 10,
    });
    const greedy = validOutput();
    greedy.stateChanges = { xp: 9999, healthDelta: -999 };
    const applied = applyDungeonMasterOutput(state, greedy);
    // XP is capped per turn by the engine, never assigned by the model.
    expect(applied.xpAwarded).toBeLessThanOrEqual(100);
    expect(state.player.xp).toBe(applied.xpAwarded);
    // Health is floored at 0, never negative.
    expect(state.player.health).toBe(0);
  });

  it("caps health at 100 regardless of healthDelta", () => {
    const state = createInitialState({
      sessionId: "s1",
      userId: "u1",
      durationMinutes: 10,
    });
    const blessed = validOutput();
    blessed.stateChanges = { xp: 0, healthDelta: 999 };
    applyDungeonMasterOutput(state, blessed);
    expect(state.player.health).toBe(100);
  });
});
