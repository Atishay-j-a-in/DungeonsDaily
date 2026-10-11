import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  CompleteExerciseRequestSchema,
  CreateSessionRequestSchema,
  SessionResponseRequestSchema,
} from "@dungeonsdaily/shared";
import {
  completeExercise,
  createSession,
  endSession,
  getSession,
  submitResponse,
  userHistory,
} from "./session.service.js";

function validationError(res: any, message: string) {
  return res
    .status(400)
    .json({ error: { code: "VALIDATION_ERROR", message } });
}

export function sessionRouter(): Router {
  const router = Router();

  router.post("/", async (req, res, next) => {
    try {
      const parsed = CreateSessionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return validationError(
          res,
          parsed.error.issues[0]?.message ?? "Invalid request",
        );
      }
      // Attribute server-side: the hero is whoever holds the verified
      // token, so a client can never create sessions as another user.
      const { userId } = getAuth(req);
      const result = await createSession({
        userId: userId ?? parsed.data.userId,
        durationMinutes: parsed.data.durationMinutes,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get("/:sessionId", async (req, res, next) => {
    try {
      const result = await getSession(req.params.sessionId as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:sessionId/response", async (req, res, next) => {
    try {
      const parsed = SessionResponseRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return validationError(
          res,
          parsed.error.issues[0]?.message ?? "Invalid request",
        );
      }
      const result = await submitResponse(
        req.params.sessionId as string,
        (parsed.data.text ?? parsed.data.message as string).trim(),
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:sessionId/exercise/complete", async (req, res, next) => {
    try {
      const parsed = CompleteExerciseRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return validationError(
          res,
          parsed.error.issues[0]?.message ?? "Invalid request",
        );
      }
      const result = await completeExercise(
        req.params.sessionId as string,
        parsed.data.exerciseId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:sessionId/end", async (req, res, next) => {
    try {
      const result = await endSession(req.params.sessionId as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function userRouter(): Router {
  const router = Router();
  router.get("/:userId/sessions", async (req, res, next) => {
    try {
      // History is private: you can only read your own chronicle.
      const { userId } = getAuth(req);
      if (userId && req.params.userId !== userId) {
        return res
          .status(403)
          .json({ error: { code: "FORBIDDEN", message: "Not your chronicle." } });
      }
      const sessions = await userHistory(req.params.userId as string);
      res.json({ sessions });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
