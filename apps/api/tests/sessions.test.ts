import { beforeEach, describe, expect, it } from "vitest";
import { SessionResponseRequestSchema } from "@dungeonsdaily/shared";
import { resetMemoryStore } from "../src/db/memory-store.js";
import {
  completeExercise,
  createSession,
  endSession,
  getSession,
  submitResponse,
} from "../src/modules/sessions/session.service.js";

// NOTE: turns run synchronously, so the first read already sees the
// result — the same shape the frontend polling loop converges on.

describe("sessions", () => {
  beforeEach(() => resetMemoryStore());

  it("creates, responds, completes exercise, and ends", async () => {
    const created = await createSession({ userId: "u1", durationMinutes: 10 });
    expect(created.sessionId).toBeTruthy();

    // Direct path: opening turn is already persisted; polling sees it at once.
    const opened = await getSession(created.sessionId);
    expect(opened.session._id).toBe(created.sessionId);
    expect(opened.turns.length).toBeGreaterThan(0);

    const response = await submitResponse(created.sessionId, "I am ready");
    expect(response.accepted).toBe(true);

    const afterResponse = await getSession(created.sessionId);
    expect(afterResponse.turns.length).toBe(opened.turns.length + 1);

    const exerciseId = (
      afterResponse.session.currentExercise as { exerciseId: string }
    ).exerciseId;
    const done = await completeExercise(created.sessionId, exerciseId);
    expect(done.accepted).toBe(true);

    const ended = await endSession(created.sessionId);
    expect(ended.accepted).toBe(true);
    const final = await getSession(created.sessionId);
    expect(final.session.status).toBe("completed");
  });

  it("rejects invalid session ids and inactive sessions", async () => {
    await expect(getSession("missing")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
    const created = await createSession({ userId: "u1", durationMinutes: 20 });
    await expect(
      completeExercise(created.sessionId, "wrong_id"),
    ).rejects.toMatchObject({ code: "INVALID_EXERCISE" });
    await endSession(created.sessionId);
    await expect(
      submitResponse(created.sessionId, "hello"),
    ).rejects.toMatchObject({ code: "SESSION_NOT_ACTIVE" });
  });

  it("rejects unsupported durations", async () => {
    await expect(
      createSession({ userId: "u1", durationMinutes: 15 as never }),
    ).rejects.toMatchObject({ code: "INVALID_DURATION" });
  });

  it("accepts text or message response fields (same pipeline)", async () => {
    expect(
      SessionResponseRequestSchema.safeParse({ text: "I am ready" }).success,
    ).toBe(true);
    expect(
      SessionResponseRequestSchema.safeParse({ message: "I attack the goblin!" })
        .success,
    ).toBe(true);
    expect(SessionResponseRequestSchema.safeParse({}).success).toBe(false);

    const created = await createSession({ userId: "u1", durationMinutes: 10 });
    const viaMessage = await submitResponse(created.sessionId, "I attack the goblin!");
    expect(viaMessage.accepted).toBe(true);
    const fetched = await getSession(created.sessionId);
    expect(fetched.turns.length).toBeGreaterThan(1);
  });
});
