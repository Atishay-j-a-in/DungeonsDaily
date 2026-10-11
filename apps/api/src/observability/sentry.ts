import * as Sentry from "@sentry/node";
import { env, hasSentry } from "../config/env.js";

let initialized = false;

// Expected client errors: tracked as breadcrumbs at the call site, never as
// Sentry issues (keeps quota for real 5xx + warnings).
const NOISE_CODES = new Set([
  "SESSION_NOT_FOUND",
  "SESSION_NOT_ACTIVE",
  "INVALID_DURATION",
  "INVALID_EXERCISE",
  "VALIDATION_ERROR",
  "FORBIDDEN",
  "NOT_FOUND",
]);

export function initSentry(): void {
  if (initialized || !hasSentry) return;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.sentryEnvironment,
    release: `dungeonsdaily-api@${process.env.npm_package_version ?? "0.1.0"}`,
    tracesSampleRate: env.nodeEnv === "production" ? 0.2 : 1,
    beforeSend(event) {
      const code = event.tags?.code;
      if (typeof code === "string" && NOISE_CODES.has(code)) return null;
      return event;
    },
  });
  initialized = true;
}

export { Sentry };

/** Wrap an async operation in a Sentry span (no-op when Sentry is off). */
export async function trace<T>(
  name: string,
  attributes: Record<string, string | number | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!hasSentry) return fn();
  return Sentry.startSpan({ name, attributes }, fn);
}

/**
 * Attach attributes (model, duration, tokens, retry count, …) to the
 * current Sentry span. Safe no-op when Sentry is off or no span is active.
 */
export function setTraceAttributes(
  attributes: Record<string, string | number | boolean | undefined>,
): void {
  if (!hasSentry) return;
  try {
    const scope = Sentry.getCurrentScope();
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined) continue;
      if (typeof value === "string") scope.setTag(key, value);
      else scope.setExtra(key, value);
    }
  } catch {
    // Observability must never break gameplay.
  }
}

/**
 * Cheap game-event breadcrumb (session created, turn answered, XP awarded,
 * fallback used). Breadcrumbs ride along with the next error, so a 5xx
 * arrives with the story of what led to it — no quota cost on their own.
 */
export function gameEvent(
  message: string,
  data?: Record<string, string | number | boolean | undefined>,
): void {
  if (!hasSentry) return;
  try {
    Sentry.addBreadcrumb({
      category: "game",
      message,
      data: data as Record<string, unknown> | undefined,
      level: "info",
    });
  } catch {
    // Observability must never break gameplay.
  }
}
