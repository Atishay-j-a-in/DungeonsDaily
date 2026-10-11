import { randomUUID } from "node:crypto";
import type {
  DungeonMasterInput,
  SessionDuration,
} from "@dungeonsdaily/shared";
import {
  ensureUser,
  findSessionById,
  insertSession,
  insertTurn,
  listRecentTurns,
  updateSession,
  type SessionDoc,
} from "../../db/repositories.js";
import {
  adventureTitleFor,
  applyDungeonMasterOutput,
  assertValidDuration,
  completeCurrentExercise,
  createInitialState,
  exerciseCatalogForPrompt,
  type AppliedTurn,
} from "../game/game-engine.js";
import { levelForXp, xpForExercise } from "../game/progression.js";
import { DungeonMasterService } from "../ai/dm-service.js";

// Core session logic: the single synchronous path for Express (game engine
// + Gemma + Mongo). Route handlers in session.service.ts are thin wrappers
// over these functions.

export type AiMeta = {
  provider: string;
  degraded: boolean;
  reason: string | null;
};

export type TurnResult = AppliedTurn & { ai: AiMeta };

export type SessionSnapshot = {
  sessionId: string;
  status: string;
  turnNumber: number;
  player: { xp: number; health: number; level: number };
  currentExercise?: SessionDoc["currentExercise"];
  lastTurn: AppliedTurn | null;
};

const dmService = new DungeonMasterService();

export function toAdventureState(doc: SessionDoc): any {
  return {
    sessionId: doc._id,
    userId: doc.userId,
    durationMinutes: doc.durationMinutes,
    status: doc.status,
    chapter: doc.adventure.chapter,
    scene: doc.adventure.scene,
    player: doc.player,
    currentExercise: doc.currentExercise,
    completedExercises: doc.completedExercises ?? [],
    turnNumber: doc.turnNumber ?? 0,
    startedAt: new Date(doc.startedAt),
    updatedAt: new Date(doc.updatedAt),
  };
}

export function persistState(doc: SessionDoc, state: any): SessionDoc {
  doc.status = state.status;
  doc.adventure = {
    title: doc.adventure.title,
    chapter: state.chapter,
    scene: state.scene,
  };
  doc.player = state.player;
  doc.currentExercise = state.currentExercise;
  doc.completedExercises = state.completedExercises;
  doc.turnNumber = state.turnNumber;
  doc.updatedAt = new Date().toISOString();
  return doc;
}

export async function buildDmInput(
  state: any,
  userText?: string,
): Promise<DungeonMasterInput> {
  const startedAt =
    state.startedAt instanceof Date ? state.startedAt : new Date(state.startedAt);
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - startedAt.getTime()) / 1000),
  );
  const recentDocs = await listRecentTurns(state.sessionId, 8);
  const recentTurns: DungeonMasterInput["recentTurns"] = [];
  for (const t of recentDocs) {
    if (t.userInput?.text) {
      recentTurns.push({ speaker: "user", text: String(t.userInput.text) });
    }
    if (t.dmOutput?.narration) {
      recentTurns.push({ speaker: "dm", text: String(t.dmOutput.narration) });
    }
  }
  if (userText) recentTurns.push({ speaker: "user", text: userText });
  return {
    sessionId: state.sessionId,
    durationMinutes: state.durationMinutes,
    elapsedSeconds,
    scene: state.scene,
    chapter: state.chapter,
    turnNumber: state.turnNumber,
    player: state.player,
    ...(state.currentExercise ? { currentExercise: state.currentExercise } : {}),
    completedExercises: state.completedExercises,
    recentTurns: recentTurns.slice(-8),
    exerciseCatalog: exerciseCatalogForPrompt(),
  };
}

export async function runDmTurn(
  doc: SessionDoc,
  state: any,
  userText?: string,
): Promise<TurnResult> {
  const input = await buildDmInput(state, userText);
  const { output, provider, degraded, reason } =
    await dmService.generateValidatedTurn(input);
  const applied = applyDungeonMasterOutput(state, output);
  persistState(doc, state);
  await updateSession(doc._id, {
    status: doc.status,
    adventure: doc.adventure,
    player: doc.player,
    currentExercise: doc.currentExercise,
    completedExercises: doc.completedExercises,
    turnNumber: doc.turnNumber,
    updatedAt: doc.updatedAt,
  });
  await insertTurn({
    sessionId: doc._id,
    turnNumber: state.turnNumber,
    userInput: userText
      ? { type: "speech", text: userText }
      : { type: "system", text: "(opening)" },
    dmOutput: {
      narration: applied.narration,
      mood: applied.mood,
      scene: applied.scene,
      action: applied.action,
      ai: { provider, degraded, reason },
    },
    createdAt: new Date().toISOString(),
  });
  return { ...applied, ai: { provider, degraded, reason } };
}

export function requireActiveSession(doc: SessionDoc): void {
  if (doc.status !== "active") {
    const err = new Error("Session is not active") as Error & { code: string };
    err.code = "SESSION_NOT_ACTIVE";
    throw err;
  }
}

export function sessionNotFound(): Error & { code: string } {
  const err = new Error("Session was not found") as Error & { code: string };
  err.code = "SESSION_NOT_FOUND";
  return err;
}

/** Create the session document WITHOUT any turn (workflow generates opening). */
export async function createBareSessionCore(input: {
  sessionId?: string;
  userId: string;
  durationMinutes: SessionDuration;
}): Promise<{ doc: SessionDoc; created: boolean }> {
  assertValidDuration(input.durationMinutes);
  await ensureUser(input.userId);
  if (input.sessionId) {
    const existing = await findSessionById(input.sessionId);
    if (existing) return { doc: existing, created: false };
  }
  const sessionId = input.sessionId ?? randomUUID();
  const now = new Date();
  const title = adventureTitleFor(sessionId);
  const state = createInitialState({
    sessionId,
    userId: input.userId,
    durationMinutes: input.durationMinutes,
    now,
  });

  const doc: SessionDoc = {
    _id: sessionId,
    userId: input.userId,
    durationMinutes: input.durationMinutes,
    status: "active",
    adventure: { title, chapter: state.chapter, scene: state.scene },
    player: state.player,
    currentExercise: undefined,
    completedExercises: [],
    turnNumber: 0,
    startedAt: now.toISOString(),
    completedAt: null,
    updatedAt: now.toISOString(),
  };
  await insertSession(doc);
  return { doc, created: true };
}

/** Idempotent full init: bare session + opening turn (direct path). */
export async function initializeSessionCore(input: {
  sessionId?: string;
  userId: string;
  durationMinutes: SessionDuration;
}): Promise<{ doc: SessionDoc; opening: TurnResult | null; created: boolean }> {
  const { doc, created } = await createBareSessionCore(input);
  const existingTurns = await listRecentTurns(doc._id, 1);
  if (existingTurns.length > 0) return { doc, opening: null, created };
  const state = toAdventureState(doc);
  const opening = await runDmTurn(doc, state);
  return { doc, opening, created };
}

export async function submitResponseCore(
  sessionId: string,
  text: string,
): Promise<{ doc: SessionDoc; turn: TurnResult }> {
  const doc = await findSessionById(sessionId);
  if (!doc) throw sessionNotFound();
  requireActiveSession(doc);
  const state = toAdventureState(doc);
  // Seamless voice & text interaction: automatically complete active exercise
  // and award XP when the player responds to the challenge.
  if (state.currentExercise && !state.currentExercise.completed) {
    try {
      const done = completeCurrentExercise(
        state,
        state.currentExercise.exerciseId,
      );
      const bonus = xpForExercise(done);
      state.player.xp += bonus;
      state.player.level = levelForXp(state.player.xp);
    } catch {
      state.currentExercise.completed = true;
    }
  }
  const turn = await runDmTurn(doc, state, text);
  return { doc, turn };
}

export async function completeExerciseCore(
  sessionId: string,
  exerciseId: string,
): Promise<{ doc: SessionDoc; xpAwarded: number }> {
  const doc = await findSessionById(sessionId);
  if (!doc) throw sessionNotFound();
  requireActiveSession(doc);
  const state = toAdventureState(doc);
  const done = completeCurrentExercise(state, exerciseId);
  const bonus = xpForExercise(done);
  state.player.xp += bonus;
  state.player.level = levelForXp(state.player.xp);
  persistState(doc, state);
  await updateSession(doc._id, {
    player: doc.player,
    currentExercise: doc.currentExercise,
    completedExercises: doc.completedExercises,
    turnNumber: doc.turnNumber,
    updatedAt: doc.updatedAt,
  });
  return { doc, xpAwarded: bonus };
}

export async function endSessionCore(
  sessionId: string,
): Promise<{ doc: SessionDoc }> {
  const doc = await findSessionById(sessionId);
  if (!doc) throw sessionNotFound();
  if (doc.status === "completed") return { doc };
  const completedAt = new Date().toISOString();
  const updated = await updateSession(doc._id, {
    status: "completed",
    completedAt,
    updatedAt: completedAt,
  });
  return { doc: updated ?? { ...doc, status: "completed", completedAt } };
}

export function snapshotOf(
  doc: SessionDoc,
  lastTurn: AppliedTurn | null,
): SessionSnapshot {
  return {
    sessionId: doc._id,
    status: doc.status,
    turnNumber: doc.turnNumber ?? 0,
    player: doc.player,
    ...(doc.currentExercise ? { currentExercise: doc.currentExercise } : {}),
    lastTurn,
  };
}
