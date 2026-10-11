// In-memory fallback so `pnpm dev` works before MongoDB Atlas is configured.
// The repository layer prefers Mongo when connected, otherwise delegates here.

export type MemorySession = Record<string, unknown> & {
  _id: string;
  userId: string;
  status: string;
};

export type MemoryTurn = Record<string, unknown> & {
  _id: string;
  sessionId: string;
  turnNumber: number;
};

const users = new Map<string, Record<string, unknown>>();
const sessions = new Map<string, MemorySession>();
const turns: MemoryTurn[] = [];

export const memoryStore = {
  users,
  sessions,
  turns,
};

export function resetMemoryStore(): void {
  users.clear();
  sessions.clear();
  turns.length = 0;
}
