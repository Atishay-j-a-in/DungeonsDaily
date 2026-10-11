import { generateText } from "ai";
import { env, hasGemma } from "../../config/env.js";
import { GEMMA_MODEL_ID, GEMMA_PROVIDER, getGemmaModel } from "./provider.js";

// Dev verification chain (no full game session needed):
//   OPENROUTER_API_KEY → Vercel AI SDK → OpenRouter gateway → model, or
//   GOOGLE_GENERATIVE_AI_API_KEY → Vercel AI SDK → Google provider → Gemma
//
// Sends a trivial prompt ("write a short joke") so the check proves the
// model round-trips without spending tokens on a full game turn.
//
// Usage: pnpm --filter @dungeonsdaily/api ai:check
// Exit 0 = live model answered. Exit 2 = key missing or call failed.
//
// NOTE: never call process.exit() here — tsx on Windows can crash inside
// libuv (UV_HANDLE_CLOSING assertion) when the process is killed while
// network handles are draining. Set process.exitCode and return instead.

async function main(): Promise<number> {
  console.log(`[ai:check] provider: ${GEMMA_PROVIDER}, model: ${GEMMA_MODEL_ID}`);
  console.log(
    `[ai:check] OPENROUTER_API_KEY: ${env.openrouterApiKey ? "set" : "MISSING"}`,
  );
  console.log(
    `[ai:check] GOOGLE_GENERATIVE_AI_API_KEY: ${env.googleApiKey ? "set" : "MISSING"}`,
  );
  if (!hasGemma) {
    console.error(
      "[ai:check] Set OPENROUTER_API_KEY in .env (free models at https://openrouter.ai) or GOOGLE_GENERATIVE_AI_API_KEY (https://aistudio.google.com).",
    );
    return 2;
  }

  try {
    const { text, usage, finishReason } = await generateText({
      model: getGemmaModel(),
      prompt: "Write a short joke (one or two sentences).",
      temperature: 0.7,
      maxOutputTokens: 512,
      maxRetries: 1,
    });

    if (finishReason === "content-filter" || !text.trim()) {
      console.error("[ai:check] FAILED: empty or filtered response.");
      return 2;
    }

    console.log(`[ai:check] joke: ${text.trim()}`);
    console.log(
      `[ai:check] tokens: in=${usage?.inputTokens ?? "?"} out=${usage?.outputTokens ?? "?"}`,
    );
    console.log("[ai:check] OK — live model answered.");
    return 0;
  } catch (err) {
    const status =
      typeof (err as { statusCode?: unknown }).statusCode === "number"
        ? ` [HTTP ${(err as { statusCode: number }).statusCode}]`
        : "";
    console.error(`[ai:check] FAILED${status}: ${(err as Error).message}`);
    return 2;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`[ai:check] FAILED: ${(err as Error).message}`);
    process.exitCode = 2;
  },
);
