import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { Sentry } from "../observability/sentry.js";

const CODE_TO_STATUS: Record<string, number> = {
  SESSION_NOT_FOUND: 404,
  NOT_FOUND: 404,
  SESSION_NOT_ACTIVE: 409,
  INVALID_DURATION: 400,
  INVALID_EXERCISE: 400,
  INVALID_DM_OUTPUT: 502,
  AI_GENERATION_FAILED: 502,
  TTS_FAILED: 502,
  STT_FAILED: 502,
  DATABASE_ERROR: 502,
  VALIDATION_ERROR: 400,
};

export function errorMiddleware(
  err: any,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const code =
    typeof err?.code === "string" ? err.code : "INTERNAL_ERROR";
  const status = CODE_TO_STATUS[code] ?? 500;
  // Scope the report: who hit it, on which route/session, with what code.
  // initSentry's beforeSend drops expected 4xx codes, so this stays a single
  // call site for both real issues and filtered noise.
  try {
    Sentry.withScope?.((scope) => {
      scope.setTag("code", code);
      scope.setTag("route", _req.path);
      const sessionId =
        (_req.params as Record<string, string> | undefined)?.sessionId ??
        (typeof (_req.body as Record<string, unknown> | undefined)?.sessionId ===
        "string"
          ? ((_req.body as Record<string, string>).sessionId as string)
          : undefined);
      if (sessionId) scope.setTag("sessionId", sessionId);
      try {
        const { userId } = getAuth(_req);
        if (userId) scope.setUser({ id: userId });
      } catch {
        // Auth context unavailable — report stays anonymous.
      }
      Sentry.captureException?.(err);
    });
  } catch {
    try {
      Sentry.captureException?.(err);
    } catch {
      // Observability must never break error responses.
    }
  }
  if (process.env.NODE_ENV !== "production") {
    console.error(`[api] ${code}:`, err?.message ?? err);
  }
  res.status(status).json({
    error: {
      code,
      message:
        status === 500
          ? "Internal server error"
          : (err?.message ?? "Request failed"),
    },
  });
}

export function notFoundMiddleware(_req: Request, res: Response): void {
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Route not found" } });
}
