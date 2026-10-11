import * as Sentry from "@sentry/react";

// Lean client coverage: error reports with click/XHR breadcrumbs attached,
// user scoped after login. No tracing, no replay — a game client pays quota
// only when something actually breaks.

let initialized = false;

export function initWebSentry(): void {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: (import.meta.env.MODE as string | undefined) ?? "development",
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
  initialized = true;
}

export { Sentry };
