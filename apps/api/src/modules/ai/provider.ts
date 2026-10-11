import { google } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { env } from "../../config/env.js";

// Single place where the model is configured. Change GEMMA_MODEL to swap
// models — nothing else in the codebase names a model.
//
// Two paths, one interface (both speak to the Vercel AI SDK):
// - OpenRouter (preferred when OPENROUTER_API_KEY is set): the model id is
//   an OpenRouter id such as `google/gemma-3-27b-it:free`, called through
//   the OpenAI-compatible gateway. `supportsStructuredOutputs: false`
//   keeps the provider in JSON-object mode (no strict server-side schema),
//   mirroring the Google path below — the prompt describes the schema and
//   the SDK validates the response client-side against our Zod schema.
// - Google direct (fallback): `google(GEMMA_MODEL_ID)` with a model id such
//   as `gemma-4-31b-it` (ai.google.dev/gemma/docs/core/gemma_on_gemini_api).
//   Do NOT silently switch to a Gemini model if a Gemma ID stops working —
//   report the incompatibility instead.
//
// Keys are never passed around, never logged, and never sent to the frontend
// (the OpenRouter key lives only in this module's closure).

export const GEMMA_MODEL_ID: string = env.gemmaModel;

export type GemmaProvider = "openrouter" | "google";

/** Which gateway serves the model: OpenRouter wins when its key is set. */
export const GEMMA_PROVIDER: GemmaProvider = env.openrouterApiKey
  ? "openrouter"
  : "google";

function getOpenRouterModel(): LanguageModel {
  const openrouter = createOpenAICompatible({
    name: "openrouter",
    apiKey: env.openrouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer":
        process.env.VITE_API_BASE_URL ?? process.env.APP_URL ?? "http://localhost:4000",
      "X-Title": "DungeonsDaily",
    },
    supportsStructuredOutputs: false,
  });
  return openrouter.chatModel(GEMMA_MODEL_ID);
}

export function getGemmaModel(): LanguageModel {
  if (env.openrouterApiKey) return getOpenRouterModel();
  if (!env.googleApiKey) {
    throw new Error(
      "Neither OPENROUTER_API_KEY nor GOOGLE_GENERATIVE_AI_API_KEY is set — live Gemma is unavailable.",
    );
  }
  return google(GEMMA_MODEL_ID);
}
