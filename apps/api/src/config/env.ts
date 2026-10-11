import dotenv from "dotenv";
import path from "node:path";

// Precedence (audit #4): API-local `.env` overrides the monorepo-root `.env`.
// dotenv does NOT override already-loaded values by default, so the local
// file must be loaded with `override: true`. The final bare lookup only
// fills variables still unset (e.g. real process environment, CI secrets).
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });
dotenv.config();

function required(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function parsePort(raw: string, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.warn(
      `[env] Invalid PORT=${JSON.stringify(raw)} — falling back to ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}

export const env = {
  nodeEnv: required("NODE_ENV", "development"),
  port: parsePort(required("PORT", "4000"), 4000),
  mongodbUri: required("MONGODB_URI", ""),
  mongodbDbName: required("MONGODB_DB_NAME", "dungeonsdaily"),
  // Audit #5: GEMMA_API_BASE_URL was a legacy Groq/OpenAI-compatible setting
  // and has no effect — the implementation uses @ai-sdk/google. It is
  // intentionally NOT read here; remove it from your .env.
  // GEMMA_API_KEY is retained only as a deprecated alias for
  // GOOGLE_GENERATIVE_AI_API_KEY (used when the Google key is absent).
  gemmaApiKey: required("GEMMA_API_KEY", ""),
  gemmaModel: required("GEMMA_MODEL", "gemma-4-31b-it"),
  // Google provider key (@ai-sdk/google reads GOOGLE_GENERATIVE_AI_API_KEY
  // automatically). GEMMA_API_KEY is accepted as an alias for the same key.
  // Server-side only — never expose to the frontend.
  googleApiKey: required(
    "GOOGLE_GENERATIVE_AI_API_KEY",
    required("GEMMA_API_KEY", ""),
  ),
  // OpenRouter gateway (OpenAI-compatible): when set, the DM calls
  // GEMMA_MODEL through https://openrouter.ai/api/v1 instead of Google
  // directly. Server-side only — never expose to the frontend.
  openrouterApiKey: required("OPENROUTER_API_KEY", ""),
  elevenlabsApiKey: required("ELEVENLABS_API_KEY", ""),
  elevenlabsVoiceId: required("ELEVENLABS_VOICE_ID", ""),
  elevenlabsModelId: required(
    "ELEVENLABS_MODEL_ID",
    "eleven_multilingual_v2",
  ),
  sentryDsn: required("SENTRY_DSN", ""),
  sentryEnvironment: required("SENTRY_ENVIRONMENT", "development"),
};

export const hasMongo = env.mongodbUri.length > 0;
// Live Gemma needs either the OpenRouter key (preferred: free Gemma 3
// models through the OpenAI-compatible gateway) or the Google provider key.
// Without either, the deterministic Fake DM keeps the game fully playable.
export const hasGemma =
  env.openrouterApiKey.length > 0 || env.googleApiKey.length > 0;
export const hasElevenLabs =
  env.elevenlabsApiKey.length > 0 && env.elevenlabsVoiceId.length > 0;
export const hasSentry = env.sentryDsn.length > 0;
