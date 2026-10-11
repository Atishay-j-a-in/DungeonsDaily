import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { getDb } from "./mongo.js";
import { memoryStore } from "./memory-store.js";

// Thin repository layer — route handlers must NOT contain raw Mongo queries.

export type SessionDoc = Record<string, any> & { _id: string };
export type TurnDoc = Record<string, any> & {
  _id: string;
  sessionId: string;
  turnNumber: number;
};

function useMongo(): Db | null {
  return getDb();
}

// --- users ---------------------------------------------------------------

export async function ensureUser(userId: string): Promise<void> {
  const db = useMongo();
  const now = new Date().toISOString();
  if (!db) {
    if (!memoryStore.users.has(userId)) {
      memoryStore.users.set(userId, {
        _id: userId,
        createdAt: now,
        updatedAt: now,
        stats: {
          totalSessions: 0,
          completedSessions: 0,
          totalMinutes: 0,
          totalXp: 0,
        },
      });
    }
    return;
  }
  await db.collection<any>("users").updateOne(
    { _id: userId },
    {
      $setOnInsert: {
        _id: userId,
        createdAt: now,
        stats: {
          totalSessions: 0,
          completedSessions: 0,
          totalMinutes: 0,
          totalXp: 0,
        },
      },
      $set: { updatedAt: now },
    },
    { upsert: true },
  );
}

// --- sessions ------------------------------------------------------------

export async function insertSession(doc: SessionDoc): Promise<SessionDoc> {
  const db = useMongo();
  if (!db) {
    memoryStore.sessions.set(doc._id, { ...doc } as any);
    return doc;
  }
  await db.collection<any>("sessions").insertOne(doc as any);
  return doc;
}

export async function findSessionById(
  sessionId: string,
): Promise<SessionDoc | null> {
  const db = useMongo();
  if (!db) return (memoryStore.sessions.get(sessionId) as SessionDoc) ?? null;
  return (await db
    .collection<any>("sessions")
    .findOne({ _id: sessionId })) as unknown as SessionDoc | null;
}

export async function updateSession(
  sessionId: string,
  patch: Record<string, any>,
): Promise<SessionDoc | null> {
  const db = useMongo();
  if (!db) {
    const existing = memoryStore.sessions.get(sessionId);
    if (!existing) return null;
    const updated = { ...existing, ...patch } as SessionDoc;
    memoryStore.sessions.set(sessionId, updated as any);
    return updated;
  }
  await db
    .collection<any>("sessions")
    .updateOne({ _id: sessionId }, { $set: patch });
  return findSessionById(sessionId);
}

export async function listSessionsByUser(
  userId: string,
): Promise<SessionDoc[]> {
  const db = useMongo();
  if (!db) {
    return [...memoryStore.sessions.values()].filter(
      (s) => s.userId === userId,
    ) as SessionDoc[];
  }
  return (await db
    .collection<any>("sessions")
    .find({ userId })
    .sort({ startedAt: -1 })
    .toArray()) as unknown as SessionDoc[];
}

// --- turns ---------------------------------------------------------------

export type NewTurn = Record<string, any> & {
  sessionId: string;
  turnNumber: number;
};

export async function insertTurn(turn: NewTurn): Promise<TurnDoc> {
  const doc: TurnDoc = { ...turn, _id: randomUUID() };
  const db = useMongo();
  if (!db) {
    memoryStore.turns.push(doc);
    return doc;
  }
  await db.collection<any>("session_turns").insertOne(doc as any);
  return doc;
}

export async function listRecentTurns(
  sessionId: string,
  limit = 8,
): Promise<TurnDoc[]> {
  const db = useMongo();
  if (!db) {
    return memoryStore.turns
      .filter((t) => t.sessionId === sessionId)
      .sort((a, b) => b.turnNumber - a.turnNumber)
      .slice(0, limit)
      .reverse();
  }
  return (await db
    .collection("session_turns")
    .find({ sessionId })
    .sort({ turnNumber: -1 })
    .limit(limit)
    .toArray()
    .then((rows) => rows.reverse())) as TurnDoc[];
}
