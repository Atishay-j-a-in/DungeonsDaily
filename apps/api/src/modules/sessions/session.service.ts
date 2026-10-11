import { randomUUID } from "node:crypto";
import type { SessionDuration } from "@dungeonsdaily/shared";
import {
  findSessionById,
  listRecentTurns,
  listSessionsByUser,
} from "../../db/repositories.js";
import { adventureTitleFor, assertValidDuration } from "../game/game-engine.js";
import {
  completeExerciseCore,
  endSessionCore,
  initializeSessionCore,
  sessionNotFound,
  submitResponseCore,
} from "./session-core.js";
import { gameEvent, trace } from "../../observability/sentry.js";

// HTTP-facing session API. Every turn runs synchronously: Express →
// session core (game engine + Gemma + Mongo) → response. The opening turn is
// generated during creation, so the first poll already sees it.

// --- public API --------------------------------------------------------

export async function createSession(input: {
  userId: string;
  durationMinutes: SessionDuration;
}) {
  assertValidDuration(input.durationMinutes);
  const sessionId = randomUUID();
  const title = adventureTitleFor(sessionId);
  const { doc, opening } = await trace(
    "session.create",
    { userId: input.userId, durationMinutes: input.durationMinutes },
    () =>
      initializeSessionCore({
        sessionId,
        userId: input.userId,
        durationMinutes: input.durationMinutes,
      }),
  );
  gameEvent("session created", {
    sessionId: doc._id,
    userId: input.userId,
    durationMinutes: input.durationMinutes,
  });
  return {
    sessionId: doc._id,
    status: doc.status,
    adventure: { title },
    opening,
  };
}

export async function getSession(sessionId: string) {
  const doc = await findSessionById(sessionId);
  if (!doc) throw sessionNotFound();
  const turns = await listRecentTurns(sessionId, 20);
  return { session: doc, turns };
}

export async function submitResponse(sessionId: string, text: string) {
  const existing = await findSessionById(sessionId);
  if (!existing) throw sessionNotFound();
  if (existing.status !== "active") {
    const err = new Error("Session is not active") as Error & { code: string };
    err.code = "SESSION_NOT_ACTIVE";
    throw err;
  }
  const baselineTurn = (existing.turnNumber as number) ?? 0;
  const { doc, turn } = await trace(
    "session.respond",
    { sessionId, textLength: text.length },
    () => submitResponseCore(sessionId, text),
  );
  gameEvent("player turn answered", {
    sessionId,
    turnNumber: (doc.turnNumber as number) ?? baselineTurn + 1,
    degraded: turn.ai.degraded,
  });
  return { accepted: true, sessionId, turnNumber: baselineTurn, turn };
}

export async function completeExercise(sessionId: string, exerciseId: string) {
  const existing = await findSessionById(sessionId);
  if (!existing) throw sessionNotFound();
  if (existing.status !== "active") {
    const err = new Error("Session is not active") as Error & { code: string };
    err.code = "SESSION_NOT_ACTIVE";
    throw err;
  }
  const current = existing.currentExercise as
    | { exerciseId: string; completed: boolean }
    | undefined;
  if (!current || current.completed || current.exerciseId !== exerciseId) {
    const err = new Error(
      "Exercise does not match current challenge",
    ) as Error & { code: string };
    err.code = "INVALID_EXERCISE";
    throw err;
  }
  const { xpAwarded } = await trace(
    "session.exercise",
    { sessionId, exerciseId },
    () => completeExerciseCore(sessionId, exerciseId),
  );
  gameEvent("exercise completed", { sessionId, exerciseId, xpAwarded });
  return { accepted: true, sessionId, exerciseId, xpAwarded };
}

export async function endSession(sessionId: string) {
  const existing = await findSessionById(sessionId);
  if (!existing) throw sessionNotFound();
  if (existing.status === "completed") return { session: existing };
  const { doc } = await trace("session.end", { sessionId }, () =>
    endSessionCore(sessionId),
  );
  gameEvent("session ended", { sessionId });
  return { accepted: true, sessionId, session: doc };
}

export async function userHistory(userId: string) {
  return listSessionsByUser(userId);
}
