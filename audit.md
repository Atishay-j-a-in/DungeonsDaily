# DungeonsDaily Final Audit

**Audit date:** 2026-10-09  
**Scope:** AI SDK, Gemma 4 configuration, Temporal integration, environment variables, and validation status  
**Change scope:** This audit adds documentation only. Application source and configuration were not changed.

## Executive summary

| Area | Verdict |
|---|---|
| Vercel AI SDK integration | Structurally correct |
| Gemma 4 31B model ID | Correct: `gemma-4-31b-it` |
| Google API key variable | Correct: `GOOGLE_GENERATIVE_AI_API_KEY` |
| Temporal server and worker startup | Verified locally |
| Temporal workflow design | Mostly correct, with important retry/idempotency risks |
| Environment wiring | Mostly correct, with stale and ignored variables |
| Build and unit tests | Passing |
| Live Gemma request | Not verified in this audit to avoid exposing or exercising the configured credential |

## Correction to the earlier model finding

The earlier audit incorrectly concluded that `gemma-4-31b-it` was unsupported because it was absent from the installed provider's generated TypeScript model union.

Google's current official Gemma Gemini API documentation lists these Gemma 4 models:

- `gemma-4-31b-it`
- `gemma-4-26b-a4b-it`

Therefore the configured value is valid:

```env
GEMMA_MODEL=gemma-4-31b-it
```

The installed `@ai-sdk/google` declarations do not constitute a complete authoritative list of server-side model IDs because the provider accepts model IDs as runtime strings. Actual availability still depends on the Google API endpoint, account, quota, and model access.

References:

- [Google Gemma on the Gemini API](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)
- [AI SDK Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google)

## Findings

| # | Severity | File | Lines | Finding | Confidence |
|---|---|---|---:|---|---:|
| 1 | HIGH | [apps/api/src/temporal/workflows/adventure.workflow.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/src/temporal/workflows/adventure.workflow.ts:45), [apps/api/src/temporal/activities/game.activity.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/src/temporal/activities/game.activity.ts:33) | 45-53, 33-157 | Retried activities perform non-idempotent AI and MongoDB side effects. A lost activity acknowledgment can cause duplicate AI generation, turn persistence, or exercise XP updates. | 9/10 |
| 2 | MEDIUM | [apps/api/src/temporal/client.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/src/temporal/client.ts:173) | 173-180 | `queryAdventureState` catches every error and returns `null`, hiding connection, namespace, workflow-not-found, and query failures behind one result. | 8/10 |
| 3 | MEDIUM | [apps/api/src/modules/ai/gemma.service.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/src/modules/ai/gemma.service.ts:40), [apps/api/src/modules/ai/dm-service.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/src/modules/ai/dm-service.ts:38) | 40-87, 38-87 | AI SDK retries, repair retries, service retries, and Temporal activity retries can multiply provider calls, latency, and token usage. | 8/10 |
| 4 | MEDIUM | [apps/api/src/config/env.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/src/config/env.ts:4) | 4-6 | The dotenv comments say later files override earlier files, but default dotenv behavior does not override already-loaded values. Root `.env` values normally win. | 9/10 |
| 5 | MEDIUM | [.env](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/.env:9), [apps/api/src/config/env.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/src/config/env.ts:18) | 9, 18 | `GEMMA_API_BASE_URL` is configured but unused. The implementation uses `@ai-sdk/google`, not a Groq/OpenAI-compatible provider. | 10/10 |
| 6 | LOW | [.env.example](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/.env.example:4), [apps/web/vite.config.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/web/vite.config.ts:6) | 4, 6 | `WEB_PORT` is documented but Vite uses a hard-coded `5173`; changing the variable has no effect. | 10/10 |
| 7 | LOW | [README.md](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/README.md:14) | 14 | Documentation refers to `generateObject`, while the implementation uses AI SDK 7 `generateText` with `Output.object`. | 10/10 |
| 8 | LOW | [apps/api/src/app.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/src/app.ts:9) | 9-22 | The temporary `POST /api/v1/temporal/test` endpoint starts a workflow and should not be exposed in production without a development guard or authentication. | 9/10 |
| 9 | LOW | [apps/api/src/config/env.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/src/config/env.ts:12) | 12 | Numeric environment values such as `PORT` use `Number(...)` without validation; malformed values can become `NaN`. | 8/10 |

## AI SDK and Gemma review

### Correct implementation choices

- AI calls are isolated in [gemma.service.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/src/modules/ai/gemma.service.ts).
- The provider is centralized in [provider.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/src/modules/ai/provider.ts).
- `GOOGLE_GENERATIVE_AI_API_KEY` is the correct environment variable for `@ai-sdk/google`.
- `google(GEMMA_MODEL_ID)` is the correct provider construction pattern.
- The game engine validates and applies model output; Gemma does not directly mutate XP, health, or database state.
- Zod validates the structured output client-side.
- The deterministic fallback keeps the application playable when AI is unavailable.
- `structuredOutputs: false` is a valid compatibility choice when server-side schema enforcement is not used. The application must continue validating the returned object, which it does.

### Current Gemma configuration

The intended active configuration is:

```env
GOOGLE_GENERATIVE_AI_API_KEY=<redacted>
GEMMA_MODEL=gemma-4-31b-it
```

The key is server-side and is not exposed through the web application.

### Stale variables

These variables are not used by the current provider implementation:

```env
GEMMA_API_BASE_URL=https://api.groq.com/openai/v1
GEMMA_API_KEY=
```

`GEMMA_API_KEY` is retained only as a compatibility fallback when the Google key is absent. `GEMMA_API_BASE_URL` has no effect at runtime.

### Live verification

The repository provides:

```powershell
pnpm --filter @dungeonsdaily/api ai:check
```

This is the appropriate live verification command. It confirms:

1. The Google key is present.
2. The configured model is called.
3. The Google provider can reach the model.
4. The model returns non-empty output.

The unit tests intentionally clear the Google key in [tests/setup.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/tests/setup.ts:4), so they do not prove live Gemma access.

## Temporal review

### Verified working

- Temporal server started on `localhost:7233`.
- Temporal UI was available on `localhost:8233`.
- The worker workflow bundle compiled successfully.
- The worker reached `RUNNING`.
- The worker listened on task queue `dungeonsdaily`.
- Workflow code keeps AI, MongoDB, network, and wall-clock side effects out of workflow code.
- AI and persistence work are placed in activities.
- Signals are queued and processed in workflow order.
- The workflow uses Temporal `sleep` and `condition`.

### Main correctness risk: activity idempotency

The workflow configures retries:

```ts
retry: { maximumAttempts: 3 }
```

The following activities perform read-modify-write operations:

- `processOpeningTurn`
- `processPlayerAction`
- `validateExercise`

These operations update sessions, insert turns, and award XP. If the activity completes its external write but the worker loses the completion acknowledgment, Temporal retries the activity. The retry can generate a second AI response or apply a second state change.

The existing unique index on `(sessionId, turnNumber)` can detect some duplicate turn inserts, but it is not a complete idempotency mechanism. It does not make the MongoDB state update and turn insert atomic, and it does not prevent duplicate AI generation.

Recommended design:

1. Give each logical workflow operation a deterministic operation ID.
2. Store the operation ID and result.
3. Return the stored result when an activity is retried.
4. Use a MongoDB transaction for state update, turn insert, and idempotency record where supported.
5. Ensure exercise completion cannot award XP twice.

## Environment audit

| Variable | Status | Notes |
|---|---|---|
| `NODE_ENV` | Correct | Read by API behavior and error handling |
| `PORT` | Correct locally | Parsed without range/type validation |
| `WEB_PORT` | Misleading | Present in configuration but ignored by Vite |
| `VITE_API_BASE_URL` | Correct | Used by the frontend |
| `MONGODB_URI` | Correctly wired | Enables MongoDB when non-empty |
| `MONGODB_DB_NAME` | Correct | Used by MongoDB connection |
| `GEMMA_API_BASE_URL` | Unused | Legacy Groq/OpenAI-compatible setting |
| `GEMMA_API_KEY` | Compatibility only | Not needed when Google key is set |
| `GEMMA_MODEL` | Correct | `gemma-4-31b-it` is the desired model |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Correct | Read automatically by `@ai-sdk/google` |
| `ELEVENLABS_API_KEY` | Correctly wired | Server TTS is intentionally disabled in the current product flow |
| `ELEVENLABS_VOICE_ID` | Correctly wired | Used by the adapter if called |
| `ELEVENLABS_MODEL_ID` | Correctly wired | Used by the adapter if called |
| `TEMPORAL_ENABLED` | Correct locally | `true` requires server and worker to be running |
| `TEMPORAL_ADDRESS` | Correct locally | Matches `localhost:7233` |
| `TEMPORAL_NAMESPACE` | Correct locally | Matches local `default` namespace |
| `TEMPORAL_TASK_QUEUE` | Correct locally | Matches API client and worker |
| `SENTRY_DSN` | Correctly wired | Enables Sentry when non-empty |
| `SENTRY_ENVIRONMENT` | Correctly wired | Passed to Sentry |

## Environment loading issue

[env.ts](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/apps/api/src/config/env.ts:4) loads the root `.env`, then the API-local `.env`, then the default dotenv lookup. Because dotenv does not override existing values by default, the first root value wins.

The code comments imply that the API-local file overrides the root file, but the behavior does not match that comment.

Choose and document one policy:

- Root `.env` is authoritative, or
- API-local `.env` explicitly uses dotenv's `override: true`.

## Security observations

- `.env` is correctly listed in [.gitignore](C:/Users/sheph/Documents/Hactoberfest/dungeonsDaily/.gitignore:11).
- Real-looking secrets were present in the local environment during the audit. They are intentionally not reproduced here.
- If those credentials have been shared outside the intended private environment, rotate the Google AI, MongoDB, ElevenLabs, and Sentry credentials.
- The temporary Temporal test route should not be exposed in production.

## Validation evidence

### Build

```text
pnpm -r build
Result: passed
```

### Tests

```text
pnpm -r test
Result: 4 test files passed
        31 tests passed
```

The tests run with Temporal disabled and external credentials cleared, so they validate the direct/fallback path rather than the live AI and Temporal path.

### Temporal startup

Observed locally:

```text
Temporal Server 1.32.0
localhost:7233
Worker state: RUNNING
taskQueue: dungeonsdaily
```

## Recommended correction order

1. Rotate any exposed credentials.
2. Keep `GEMMA_MODEL=gemma-4-31b-it`.
3. Run `pnpm --filter @dungeonsdaily/api ai:check` to verify live model access.
4. Remove or clearly label unused `GEMMA_API_BASE_URL` and compatibility `GEMMA_API_KEY`.
5. Make dotenv precedence explicit.
6. Add environment schema validation.
7. Add Temporal integration tests with a real local server and worker.
8. Make AI, turn persistence, and exercise activities idempotent.
9. Improve Temporal query error handling.
10. Guard or remove the temporary Temporal test endpoint.
11. Fix or remove `WEB_PORT`.
12. Update README and environment documentation.

## Final verdict

The Gemma configuration is **not fundamentally wrong**. `gemma-4-31b-it` is the correct model identifier for the Google Gemini API, and the AI SDK provider setup is structurally correct.

The highest-risk unresolved issue is not the model configuration. It is the lack of idempotency around retried Temporal activities that perform AI generation and database/game-state writes.

