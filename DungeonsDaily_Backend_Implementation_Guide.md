# DungeonsDaily Backend Implementation Guide

## 0. Mission

Build the **backend-first MVP of DungeonsDaily**, a voice-driven fantasy
fitness RPG.

DungeonsDaily is inspired by tabletop RPGs such as Dungeons & Dragons,
but it is **not a D&D rules implementation**. The user enters a 10, 20,
or 30 minute workout adventure. An AI Dungeon Master narrates the world,
assigns safe bodyweight exercises as in-world challenges, listens to the
user's spoken responses, reacts to those responses, and advances the
adventure.

The core product loop is:

``` text
Start Adventure
    ↓
AI narrates
    ↓
AI gives an exercise challenge
    ↓
User performs exercise
    ↓
User speaks a response
    ↓
Speech → text
    ↓
Gemma interprets the response + game state
    ↓
Game state changes
    ↓
Gemma generates the next narration / event
    ↓
Text → speech
    ↓
Audio is played
    ↓
Repeat until the session ends
```

### Critical product principle

**The screen should be the shortest part of the experience.**

The backend must therefore be designed around short, voice-friendly
turns rather than long chatbot messages.

The AI should feel like a live Dungeon Master, not a generic fitness
chatbot.

------------------------------------------------------------------------

# 1. Technology Decisions

## Required stack

### Backend

-   **Node.js**
-   **TypeScript**
-   **Express**
-   **pnpm**
-   **MongoDB Atlas**
-   Official MongoDB Node.js driver (`mongodb`)
-   **Google Gemma** as the open-weight/open-model AI core
-   **ElevenLabs** for high-quality text-to-speech
-   **Temporal TypeScript SDK** for durable adventure/session
    orchestration
-   **Sentry** for backend errors and AI/agent tracing
-   Zod for runtime validation
-   dotenv for local environment configuration
-   Vitest for tests

### Dummy frontend

Use a minimal **React + Vite + TypeScript** frontend.

The frontend is intentionally not the main task yet. It only needs
enough functionality to exercise the backend:

-   create/start a session
-   show the current narration
-   show the current exercise
-   send a text response
-   optionally use browser microphone speech recognition if easy
-   request/play generated TTS audio
-   show session state
-   end a session

Do **not** spend time on visual polish.

------------------------------------------------------------------------

# 2. Important AI Architecture Decision

## Gemma is the AI Dungeon Master

Gemma must be the core intelligence responsible for:

1.  interpreting the current game state,
2.  interpreting the user's response,
3.  generating the next story beat,
4.  selecting or requesting an exercise,
5.  deciding the emotional/narrative tone,
6.  producing structured output for the backend.

The backend game engine remains authoritative.

**Do not allow the LLM to directly mutate arbitrary database state.**

The correct relationship is:

``` text
Gemma
  ↓
Structured DM decision
  ↓
Game Engine validation
  ↓
MongoDB / Temporal state update
```

Gemma is the narrator/reasoner.

The game engine is the rules authority.

------------------------------------------------------------------------

# 3. Gemma Model Strategy

Use a current **Gemma instruction-tuned model** suitable for the
available compute.

Prefer the smallest capable model for development and make the model
configurable through an environment variable.

Example:

``` env
GEMMA_MODEL=gemma-4-26b-a4b-it
```

Do not hard-code the model name throughout the codebase.

The implementation must isolate model access behind an interface such
as:

``` ts
interface DungeonMasterModel {
  generateTurn(input: DungeonMasterInput): Promise<DungeonMasterOutput>;
}
```

This allows the model to be swapped later without rewriting the game
engine.

### Important open-model requirement

The project must clearly document that Gemma is the **open-weight AI
core** of DungeonsDaily.

Do not replace Gemma with Gemini merely because Gemini is easier to
call.

If the first implementation uses a hosted Gemma API for development,
keep the AI adapter separate so the same interface can later point to a
locally/self-hosted Gemma deployment.

------------------------------------------------------------------------

# 4. AI Output Must Be Structured

Do not allow Gemma to return arbitrary prose as the only response.

Every DM turn should produce a structured object.

Use a schema similar to:

``` ts
const DungeonMasterOutputSchema = z.object({
  narration: z.string().max(500),

  mood: z.enum([
    "calm",
    "mysterious",
    "tense",
    "combat",
    "victorious",
    "danger"
  ]),

  scene: z.object({
    environment: z.enum([
      "forest",
      "cave",
      "dungeon",
      "castle",
      "village",
      "battlefield",
      "mountain",
      "ruins"
    ]),
    music: z.string().optional(),
    ambientSounds: z.array(z.string()).max(5),
    soundEffects: z.array(z.string()).max(5)
  }),

  action: z.object({
    type: z.enum([
      "narrate",
      "exercise",
      "choice",
      "complete"
    ]),
    exerciseId: z.string().optional(),
    reps: z.number().int().positive().optional(),
    durationSeconds: z.number().int().positive().optional(),
    prompt: z.string().max(200)
  }),

  responseExpectation: z.enum([
    "none",
    "user_speech",
    "exercise_completion"
  ]),

  stateChanges: z.object({
    xp: z.number().int().min(0),
    healthDelta: z.number().int(),
  })
});
```

The exact schema may be refined during implementation, but **structured
output and runtime validation are mandatory**.

If Gemma produces invalid output:

1.  do not save it as authoritative state;
2.  retry once with a repair prompt;
3.  if still invalid, use a deterministic fallback response.

------------------------------------------------------------------------

# 5. Game Engine

Create a deterministic game engine separate from the LLM.

Suggested module:

``` text
src/modules/game/
├── game-engine.ts
├── game-state.ts
├── exercise-engine.ts
├── scene-engine.ts
├── progression.ts
└── types.ts
```

The game engine owns:

-   session status,
-   current scene,
-   current encounter,
-   current exercise,
-   elapsed time,
-   XP,
-   player health,
-   completed exercises,
-   story chapter,
-   available exercise pool,
-   session completion.

The LLM does not own these values.

------------------------------------------------------------------------

# 6. Session Types

Support exactly three MVP durations:

``` text
10 minutes
20 minutes
30 minutes
```

Represent them as:

``` ts
type SessionDuration = 10 | 20 | 30;
```

A session should have:

``` ts
type SessionStatus =
  | "created"
  | "active"
  | "paused"
  | "completed"
  | "abandoned";
```

The backend must reject unsupported durations.

------------------------------------------------------------------------

# 7. Exercise Library

Create a deterministic exercise catalog.

Start with safe, equipment-free exercises.

Example:

``` ts
type Exercise = {
  id: string;
  name: string;
  category: "strength" | "cardio" | "core" | "mobility";
  difficulty: "easy" | "medium" | "hard";
  defaultReps?: number;
  defaultDurationSeconds?: number;
  equipment: "none";
};
```

Initial exercises:

-   squats
-   lunges
-   jumping jacks
-   high knees
-   mountain climbers
-   push-ups
-   wall sit
-   plank
-   standing knee raises
-   bodyweight calf raises

Keep the initial catalog small and deterministic.

The LLM should select from valid exercise IDs rather than inventing
arbitrary exercises.

------------------------------------------------------------------------

# 8. Exercise Safety Rules

The AI is not a medical professional.

The MVP should use only simple bodyweight exercises and should not give
medical advice.

Hard-code basic limits in the backend.

Examples:

``` text
maximum normal reps: 30
maximum continuous exercise duration: 120 seconds
no dangerous exercise generation
no equipment-dependent exercise unless explicitly supported
```

The game engine must validate the exercise before accepting an LLM
decision.

If Gemma requests an invalid exercise:

``` text
LLM request
    ↓
Exercise validator
    ↓
invalid
    ↓
replace with deterministic valid exercise
```

Do not trust model output blindly.

------------------------------------------------------------------------

# 9. Adventure State

Use a state object similar to:

``` ts
type AdventureState = {
  sessionId: string;
  userId: string;

  durationMinutes: 10 | 20 | 30;

  status: SessionStatus;

  chapter: number;
  scene: string;

  player: {
    xp: number;
    health: number;
    level: number;
  };

  currentExercise?: {
    exerciseId: string;
    reps?: number;
    durationSeconds?: number;
    completed: boolean;
  };

  completedExercises: string[];

  turnNumber: number;

  startedAt: Date;
  updatedAt: Date;
};
```

This state must be serializable and persistable.

------------------------------------------------------------------------

# 10. MongoDB Atlas

Use **MongoDB Atlas** as the persistent database.

Use the official `mongodb` Node.js driver rather than introducing
Mongoose unless there is a strong reason.

Create a single reusable `MongoClient`.

Do not open a new MongoDB connection on every request.

Suggested collections:

``` text
users
sessions
session_turns
```

## users

``` json
{
  "_id": "...",
  "name": "King",
  "createdAt": "...",
  "updatedAt": "...",
  "stats": {
    "totalSessions": 0,
    "completedSessions": 0,
    "totalMinutes": 0,
    "totalXp": 0
  }
}
```

## sessions

``` json
{
  "_id": "...",
  "userId": "...",
  "durationMinutes": 20,
  "status": "active",

  "adventure": {
    "title": "The Cursed Forest",
    "chapter": 1,
    "scene": "forest"
  },

  "player": {
    "level": 1,
    "xp": 0,
    "health": 100
  },

  "currentExercise": {
    "exerciseId": "squats",
    "reps": 10,
    "completed": false
  },

  "startedAt": "...",
  "completedAt": null,
  "updatedAt": "..."
}
```

## session_turns

Store the conversation separately rather than putting an unlimited
transcript inside `sessions`.

``` json
{
  "_id": "...",
  "sessionId": "...",
  "turnNumber": 4,

  "userInput": {
    "type": "speech",
    "text": "I am ready"
  },

  "dmOutput": {
    "narration": "The ancient gate begins to open...",
    "mood": "tense",
    "action": {
      "type": "exercise",
      "exerciseId": "squats",
      "reps": 10
    }
  },

  "createdAt": "..."
}
```

Add indexes for:

``` text
users._id
sessions.userId
sessions.status
session_turns.sessionId
session_turns.sessionId + turnNumber
```

------------------------------------------------------------------------

# 11. Express API

Create versioned REST APIs.

Base path:

``` text
/api/v1
```

## Health

``` http
GET /api/v1/health
```

Response:

``` json
{
  "status": "ok"
}
```

## Create session

``` http
POST /api/v1/sessions
```

Request:

``` json
{
  "userId": "...",
  "durationMinutes": 20
}
```

Response:

``` json
{
  "sessionId": "...",
  "status": "active",
  "adventure": {
    "title": "The Forgotten Dungeon"
  }
}
```

## Get session

``` http
GET /api/v1/sessions/:sessionId
```

## Submit user response

``` http
POST /api/v1/sessions/:sessionId/response
```

Request:

``` json
{
  "text": "I am ready"
}
```

The backend should:

1.  load the session;
2.  validate that it is active;
3.  load relevant recent turns;
4.  construct the Gemma input;
5.  call Gemma;
6.  validate structured output;
7.  validate exercise/action;
8.  update game state;
9.  persist the turn;
10. return the next DM turn.

## Complete exercise

``` http
POST /api/v1/sessions/:sessionId/exercise/complete
```

Request:

``` json
{
  "exerciseId": "squats"
}
```

The backend verifies that this is the currently assigned exercise before
marking it complete.

## End session

``` http
POST /api/v1/sessions/:sessionId/end
```

The backend calculates final XP and marks the session completed.

## Session history

``` http
GET /api/v1/users/:userId/sessions
```

------------------------------------------------------------------------

# 12. Voice Architecture

The voice experience has three separate layers.

``` text
Speech-to-Text
      ↓
User text
      ↓
Gemma
      ↓
Narration text
      ↓
Text-to-Speech
      ↓
Audio
```

For the MVP, keep audio transport simple.

The browser can record audio and send it to the backend later. For the
first backend milestone, the API must already support text input so the
game can be developed and tested without microphone complexity.

------------------------------------------------------------------------

# 13. ElevenLabs

Use ElevenLabs for the Dungeon Master's voice.

Create a service:

``` text
src/modules/voice/
├── elevenlabs.service.ts
├── voice.types.ts
└── voice.controller.ts
```

Interface:

``` ts
interface TextToSpeechService {
  synthesize(text: string): Promise<Buffer>;
}
```

Do not call ElevenLabs directly from route handlers.

The API key must only exist on the backend.

Environment variable:

``` env
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
```

Create:

``` http
POST /api/v1/voice/synthesize
```

Request:

``` json
{
  "text": "The dragon awakens."
}
```

The endpoint should return audio with the correct content type.

Do not store raw audio binary inside MongoDB.

For the initial MVP, generated audio can be returned directly to the
frontend.

------------------------------------------------------------------------

# 14. Audio Environment System

DungeonsDaily should not only speak.

Every scene can define an audio environment.

Example:

``` ts
type AudioScene = {
  environment:
    | "forest"
    | "cave"
    | "dungeon"
    | "castle"
    | "battlefield";

  ambientSounds: string[];

  soundEffects: string[];

  music?: string;
};
```

Gemma may suggest audio cues, but the backend must validate them against
a known whitelist.

Example:

``` text
forest
  - rain
  - wind
  - birds
  - footsteps
  - branch_snap

cave
  - cave_drips
  - wind
  - distant_roar
  - footsteps

dungeon
  - chains
  - fire
  - footsteps
  - door
  - monster_growl
```

The model must not be allowed to request arbitrary file paths or URLs.

The backend should return audio event metadata to the frontend.

------------------------------------------------------------------------

# 15. Speech-to-Text

The initial backend architecture must support a pluggable STT provider.

Create:

``` ts
interface SpeechToTextService {
  transcribe(audio: Buffer, mimeType: string): Promise<string>;
}
```

Do not tightly couple the game engine to a specific STT vendor.

The first implementation may use a browser-side STT fallback in the
dummy frontend if that is faster for the hackathon.

The backend must still expose an abstraction so a proper open/local STT
implementation can be added later.

If using Gemma 4 audio-capable variants for experimentation, keep that
behind the same adapter. Do not make the game engine depend on a
specific audio model.

------------------------------------------------------------------------

# 16. Temporal

Use **Temporal TypeScript SDK** for durable session orchestration.

Do not put normal CRUD operations into Temporal.

Use Temporal for the long-running adventure lifecycle.

Conceptually:

``` text
StartSessionWorkflow
       │
       ├── initialize session
       │
       ├── generate opening scene
       │
       ├── wait for user response
       │
       ├── process response
       │
       ├── assign exercise
       │
       ├── wait for exercise completion
       │
       ├── generate next scene
       │
       ├── repeat
       │
       └── complete session
```

Use Temporal primitives appropriately:

-   Workflow for the adventure lifecycle
-   Activities for external side effects
-   Signals for user events
-   Timers for workout/session timing
-   Queries if useful for reading workflow state

External calls such as:

-   MongoDB
-   Gemma
-   ElevenLabs

must happen in **Activities**, not directly inside workflow code.

Do not put API keys or non-deterministic logic directly inside workflow
functions.

------------------------------------------------------------------------

# 17. Temporal Workflow Design

Create:

``` text
src/temporal/
├── workflows/
│   └── dungeon-session.workflow.ts
├── activities/
│   ├── session.activities.ts
│   ├── ai.activities.ts
│   └── voice.activities.ts
├── worker.ts
└── client.ts
```

The workflow should be deterministic.

Example conceptual flow:

``` text
START
  ↓
initializeSession()
  ↓
generateOpeningTurn()
  ↓
wait for user event
  ↓
processTurn()
  ↓
wait for exercise completion if required
  ↓
check session duration
  ↓
next turn
  ↓
FINISH
```

Do not make Temporal responsible for serving HTTP responses.

Express remains the public API.

------------------------------------------------------------------------

# 18. Express ↔ Temporal Communication

The flow should be:

``` text
Frontend
   ↓
Express
   ↓
Temporal Client
   ↓
Workflow Signal
   ↓
Temporal Workflow
   ↓
Activities
   ├── Gemma
   ├── MongoDB
   └── ElevenLabs
```

For example:

``` http
POST /api/v1/sessions/:id/response
```

should:

1.  validate the request;
2.  find the Temporal workflow ID for the session;
3.  send a signal containing the user's response;
4.  return the resulting/current session state.

Do not create a new workflow for every user message.

One session = one durable workflow.

------------------------------------------------------------------------

# 19. Sentry

Add Sentry from the beginning.

Use it for:

-   Express errors,
-   unhandled exceptions,
-   Gemma calls,
-   ElevenLabs calls,
-   Temporal activity failures,
-   MongoDB errors,
-   latency measurements.

Add useful attributes such as:

``` text
sessionId
userId
durationMinutes
turnNumber
model
exerciseId
```

Do not send sensitive user audio or entire private conversations as
arbitrary Sentry metadata.

Create spans around important operations:

``` text
HTTP request
  ├── MongoDB load session
  ├── Gemma generation
  ├── validate DM output
  ├── MongoDB save turn
  └── ElevenLabs TTS
```

The purpose is to make it easy to answer:

> "Why did this AI turn take 4 seconds?"

------------------------------------------------------------------------

# 20. Backend Project Structure

Use this structure unless there is a compelling reason to change it:

``` text
dungeonsdaily/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   ├── middleware/
│   │   │   ├── routes/
│   │   │   ├── modules/
│   │   │   │   ├── users/
│   │   │   │   ├── sessions/
│   │   │   │   ├── game/
│   │   │   │   ├── ai/
│   │   │   │   ├── voice/
│   │   │   │   └── audio/
│   │   │   ├── db/
│   │   │   ├── temporal/
│   │   │   ├── observability/
│   │   │   ├── app.ts
│   │   │   └── server.ts
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/
│       ├── src/
│       ├── package.json
│       └── ...
│
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── schemas/
│       │   └── types/
│       └── package.json
│
├── package.json
├── pnpm-workspace.yaml
├── .env.example
├── .gitignore
└── README.md
```

Use `packages/shared` for API schemas and types that the dummy frontend
needs.

Do not duplicate DTO definitions between frontend and backend.

------------------------------------------------------------------------

# 21. pnpm Workspace

Use pnpm workspaces.

Root `package.json` should contain scripts similar to:

``` json
{
  "scripts": {
    "dev": "pnpm --parallel --filter @dungeonsdaily/api --filter @dungeonsdaily/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
}
```

Use package names:

``` text
@dungeonsdaily/api
@dungeonsdaily/web
@dungeonsdaily/shared
```

Use one lockfile at the repository root.

Do not create separate package managers or lockfiles inside
applications.

------------------------------------------------------------------------

# 22. Environment Variables

Create `.env.example`:

``` env
NODE_ENV=development
PORT=4000

MONGODB_URI=
MONGODB_DB_NAME=dungeonsdaily

GEMMA_MODEL=
GEMMA_API_KEY=

ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=

TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=dungeonsdaily

SENTRY_DSN=
SENTRY_ENVIRONMENT=development
```

Never commit `.env`.

Never put server API keys in the React application.

------------------------------------------------------------------------

# 23. Error Handling

Create a consistent API error format:

``` json
{
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Session was not found"
  }
}
```

Use typed application errors:

``` text
SESSION_NOT_FOUND
SESSION_NOT_ACTIVE
INVALID_DURATION
INVALID_EXERCISE
INVALID_DM_OUTPUT
AI_GENERATION_FAILED
TTS_FAILED
STT_FAILED
TEMPORAL_ERROR
DATABASE_ERROR
```

Do not expose internal stack traces in production responses.

Log detailed errors through Sentry.

------------------------------------------------------------------------

# 24. AI Prompt Design

Create the Dungeon Master system prompt as a versioned file:

``` text
src/modules/ai/prompts/dungeon-master.v1.ts
```

The system prompt must establish:

``` text
You are the Dungeon Master of DungeonsDaily.

Your purpose is to turn a short physical workout into an immersive fantasy adventure.

You speak to the player through voice.

Keep narration concise because it will be spoken aloud.

Never produce long paragraphs.

Never give unsafe or extreme exercise instructions.

Only select exercises from the supplied exercise catalog.

Never invent exercise IDs.

The game engine is authoritative for health, XP, time, exercise validity, and session status.

React naturally to what the player says.

Make the story evolve based on player responses.

Use dramatic but concise language.

Do not mention that you are an AI.

Do not mention internal game state.

Return only the requested structured output.
```

The prompt should receive:

``` text
session duration
elapsed time
current scene
player level
player XP
player health
current exercise
completed exercises
recent conversation turns
available exercise catalog
```

Do not send the entire session history forever.

Keep a bounded recent-turn context.

------------------------------------------------------------------------

# 25. Example AI Turn

Input:

``` json
{
  "scene": "dark_forest",
  "player": {
    "level": 2,
    "xp": 120,
    "health": 90
  },
  "recentTurns": [
    {
      "speaker": "dm",
      "text": "The forest grows silent."
    },
    {
      "speaker": "user",
      "text": "I keep moving forward."
    }
  ]
}
```

Expected output:

``` json
{
  "narration": "You push deeper into the forest. A massive wolf steps from the shadows.",
  "mood": "danger",
  "scene": {
    "environment": "forest",
    "ambientSounds": ["wind", "distant_birds"],
    "soundEffects": ["wolf_growl"]
  },
  "action": {
    "type": "exercise",
    "exerciseId": "squats",
    "reps": 10,
    "prompt": "Defeat the wolf with ten powerful squats."
  },
  "responseExpectation": "exercise_completion",
  "stateChanges": {
    "xp": 20,
    "healthDelta": 0
  }
}
```

The game engine then validates and applies the state change.

------------------------------------------------------------------------

# 26. Dummy Frontend

The frontend is intentionally basic.

Create these screens/components:

``` text
Home
  ↓
Select 10 / 20 / 30 minutes
  ↓
Start Session
  ↓
Session Screen
  ├── adventure title
  ├── narration
  ├── current exercise
  ├── XP
  ├── health
  ├── text input
  ├── submit response
  └── play voice
```

Do not spend time on advanced styling.

The frontend's purpose is to prove that the backend works.

Use the browser's built-in audio playback for returned TTS audio.

------------------------------------------------------------------------

# 27. Implementation Order

Follow these steps **in exactly this order**.

## Phase 1 --- Repository setup

1.  Create the pnpm workspace.
2.  Create `apps/api`.
3.  Create `apps/web`.
4.  Create `packages/shared`.
5.  Configure TypeScript.
6.  Configure ESLint/formatting if desired.
7.  Add basic scripts.
8.  Add `.env.example`.
9.  Confirm `pnpm install` works.
10. Confirm API and dummy frontend start independently.

**Do not implement AI yet.**

------------------------------------------------------------------------

## Phase 2 --- Express foundation

1.  Create Express application.
2.  Add JSON parsing.
3.  Add CORS.
4.  Add request logging.
5.  Add centralized error handling.
6.  Add `/api/v1/health`.
7.  Add graceful shutdown.
8.  Make the port configurable.

Acceptance:

``` text
GET /api/v1/health
```

returns:

``` json
{
  "status": "ok"
}
```

------------------------------------------------------------------------

## Phase 3 --- MongoDB

1.  Implement MongoDB client singleton.
2.  Implement environment configuration.
3.  Connect during application startup.
4.  Add database health check.
5.  Create repository modules.
6.  Create users repository.
7.  Create sessions repository.
8.  Create session turns repository.
9.  Create indexes.
10. Test create/read/update operations.

Do not place raw MongoDB queries inside route handlers.

------------------------------------------------------------------------

## Phase 4 --- Game engine

1.  Define session types.
2.  Define adventure state.
3.  Define exercise catalog.
4.  Implement exercise validation.
5.  Implement XP calculation.
6.  Implement level calculation.
7.  Implement session duration validation.
8.  Implement state transitions.
9.  Write unit tests.

At this stage the game must work **without any AI**.

Create deterministic fake Dungeon Master responses for testing.

------------------------------------------------------------------------

## Phase 5 --- Gemma adapter

1.  Create `DungeonMasterModel` interface.
2.  Create Gemma implementation.
3.  Create system prompt.
4.  Create structured output schema.
5.  Validate Gemma output with Zod.
6.  Implement one retry for invalid output.
7.  Implement deterministic fallback.
8.  Add Sentry tracing around the generation call.
9.  Write mocked unit tests.

The game engine must never directly depend on the concrete Gemma SDK.

------------------------------------------------------------------------

## Phase 6 --- Session API

Implement:

``` text
POST   /api/v1/sessions
GET    /api/v1/sessions/:id
POST   /api/v1/sessions/:id/response
POST   /api/v1/sessions/:id/exercise/complete
POST   /api/v1/sessions/:id/end
GET    /api/v1/users/:userId/sessions
```

Connect the APIs to:

``` text
MongoDB
+
Game Engine
+
Gemma
```

At this point a complete text-based adventure must work.

------------------------------------------------------------------------

## Phase 7 --- ElevenLabs

1.  Create TTS service interface.
2.  Implement ElevenLabs adapter.
3.  Add API key configuration.
4.  Add voice ID configuration.
5.  Add TTS endpoint.
6.  Add Sentry tracing.
7.  Test audio response.
8.  Connect dummy frontend to audio playback.

Do not make TTS a requirement for the core game logic.

If TTS fails, the game should still be able to continue.

------------------------------------------------------------------------

## Phase 8 --- Audio environment

1.  Define allowed environments.
2.  Define allowed ambient sounds.
3.  Define allowed sound effects.
4.  Add audio metadata to DM output.
5.  Validate audio cues.
6.  Return audio event metadata to the frontend.

The first version can use a small static sound library.

Do not build AI-generated sound effects yet.

------------------------------------------------------------------------

## Phase 9 --- Temporal

1.  Set up Temporal locally.
2.  Install Temporal TypeScript SDK.
3.  Create Temporal client.
4.  Create worker.
5.  Create dungeon session workflow.
6.  Create activities.
7.  Move Gemma calls into activities.
8.  Move MongoDB side effects into activities.
9.  Add user-response signals.
10. Add exercise-completion signals.
11. Add timers.
12. Connect Express session APIs to Temporal.
13. Test workflow recovery.

Do not block the entire MVP on Temporal.

If Temporal setup becomes the bottleneck, keep the deterministic session
service working and integrate Temporal before final deployment.

------------------------------------------------------------------------

## Phase 10 --- Sentry

1.  Initialize Sentry.
2.  Add Express error monitoring.
3.  Add AI generation spans.
4.  Add TTS spans.
5.  Add MongoDB operation spans where useful.
6.  Add Temporal activity instrumentation where practical.
7.  Attach session/turn metadata.
8.  Verify errors appear in Sentry.

------------------------------------------------------------------------

## Phase 11 --- Dummy frontend integration

Implement the minimum flow:

``` text
Select duration
      ↓
Create session
      ↓
Display opening narration
      ↓
Play TTS
      ↓
Display exercise
      ↓
User clicks "Complete Exercise"
      ↓
User types response
      ↓
POST response
      ↓
Display next narration
      ↓
Play TTS
```

Only after this works should microphone support be added.

------------------------------------------------------------------------

# 28. Testing Requirements

Write tests for:

### Game engine

-   valid duration
-   invalid duration
-   valid exercise
-   invalid exercise
-   XP calculation
-   level progression
-   session completion

### AI

-   valid Gemma output
-   malformed Gemma output
-   invalid exercise ID
-   missing action
-   fallback behavior

### Sessions

-   create session
-   retrieve session
-   response
-   exercise completion
-   end session
-   invalid session ID
-   inactive session

### Temporal

-   workflow starts
-   signal is received
-   exercise completion signal works
-   workflow completes

Do not test actual ElevenLabs/Gemma calls in unit tests. Mock them.

------------------------------------------------------------------------

# 29. Development Commands

The repository should support:

``` bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm lint
```

For individual apps:

``` bash
pnpm --filter @dungeonsdaily/api dev
pnpm --filter @dungeonsdaily/web dev
```

Document Temporal local startup separately.

------------------------------------------------------------------------

# 30. Render Deployment

Deploy the Express API as a Render Web Service.

The backend must:

-   listen on `0.0.0.0`;
-   use `process.env.PORT`;
-   have a production start command;
-   read secrets from Render environment variables;
-   connect to MongoDB Atlas;
-   connect to the required AI/TTS services;
-   expose `/api/v1/health`.

Render deployment should be documented in `README.md`.

Do not hard-code deployment URLs.

------------------------------------------------------------------------

# 31. Definition of Done

The backend MVP is complete only when this exact flow works:

``` text
1. User opens dummy frontend.

2. User chooses:
   10 / 20 / 30 minutes.

3. Frontend creates a session.

4. Backend creates a session in MongoDB.

5. Dungeon Master generates an opening scene.

6. Backend validates the structured Gemma response.

7. Frontend displays the narration.

8. Frontend requests TTS.

9. User hears the Dungeon Master.

10. User sees/receives an exercise challenge.

11. User completes the exercise.

12. User sends a response.

13. Backend sends the response into the session/game engine.

14. Gemma receives bounded game context.

15. Gemma generates the next story beat.

16. Backend validates the response.

17. MongoDB stores the turn.

18. Temporal maintains the session lifecycle.

19. Sentry records important AI/backend operations.

20. Frontend plays the next narration.

21. The adventure continues until the session duration is reached.

22. Session is marked completed.

23. XP and session statistics are persisted.

24. User can retrieve the completed session from history.
```

------------------------------------------------------------------------

# 32. What NOT to Build Yet

Do not implement these in the first backend milestone:

-   social features
-   leaderboards
-   multiplayer
-   D&D character-sheet compatibility
-   payments
-   subscriptions
-   advanced authentication
-   custom exercise video generation
-   AI-generated sound effects
-   image generation
-   complex 3D graphics
-   mobile applications
-   fine-tuning
-   vector database
-   RAG
-   recommendation engine
-   complicated frontend animations

The first objective is:

> **One user + one adventure + voice + exercise + dynamic story +
> persistent session.**

------------------------------------------------------------------------

# 33. Engineering Rules for the Agent

Follow these rules while implementing.

### Rule 1

Do not rewrite working code unnecessarily.

### Rule 2

Do not introduce a new framework or database without a clear
requirement.

### Rule 3

Keep provider-specific code behind interfaces.

### Rule 4

Never expose API keys to the frontend.

### Rule 5

Never trust LLM output without validation.

### Rule 6

Never let the LLM directly modify arbitrary game state.

### Rule 7

Never put external side effects directly inside Temporal workflows.

### Rule 8

Keep MongoDB access inside repositories/services.

### Rule 9

Keep Express routes thin.

### Rule 10

Keep the game engine deterministic and independently testable.

### Rule 11

Prefer small modules over one giant `server.ts`.

### Rule 12

Every new API endpoint must have request validation.

### Rule 13

Every important external AI operation should be observable through
Sentry.

### Rule 14

The backend must continue functioning if TTS is temporarily unavailable.

### Rule 15

The open-weight Gemma model is a core architectural requirement, not an
optional decorative integration.

------------------------------------------------------------------------

# 34. Final Architecture

The intended final backend architecture is:

``` text
                       React
                    Dummy Frontend
                         │
                         │ REST
                         ▼
                 ┌────────────────┐
                 │    Express     │
                 │   API Layer    │
                 └───────┬────────┘
                         │
             ┌───────────┼────────────┐
             │           │            │
             ▼           ▼            ▼
          Session      Game         Voice
          Service      Engine       Service
             │           │            │
             │           │            ▼
             │           │        ElevenLabs
             │           │
             │           ▼
             │         Gemma
             │           │
             │           ▼
             │      DM Decision
             │
             ▼
          Temporal
          Workflow
             │
       ┌─────┼─────┐
       ▼     ▼     ▼
    MongoDB Gemma ElevenLabs
     Atlas   AI      TTS
       │
       ▼
   Persistent
    Sessions

             ┌─────────────────────┐
             │       Sentry        │
             │ Errors + AI Tracing │
             └─────────────────────┘
```

The important architectural separation is:

``` text
Gemma       = intelligence / Dungeon Master
Game Engine = rules / validation
Temporal    = durable session orchestration
MongoDB     = persistence
ElevenLabs  = voice output
Sentry      = observability
Express     = API
React       = temporary test client
```

------------------------------------------------------------------------

# 35. Success Criterion

At the end of the first implementation, I should be able to run:

``` bash
pnpm install
pnpm dev
```

and experience:

> **"You stand at the entrance of the Forgotten Dungeon..."**

The system should then dynamically narrate an adventure, assign an
exercise, accept the user's response, react to it, generate the next
scene, speak the narration, persist the session, and eventually complete
the workout.

That is the MVP.

Everything else comes afterward.

------------------------------------------------------------------------

## Official documentation references

-   Google Gemma: https://ai.google.dev/gemma/docs
-   Gemma running/inference: https://ai.google.dev/gemma/docs/run
-   ElevenLabs TTS:
    https://elevenlabs.io/docs/overview/capabilities/text-to-speech
-   MongoDB Node.js Driver:
    https://www.mongodb.com/docs/drivers/node/current/
-   Temporal TypeScript: https://docs.temporal.io/develop/typescript
-   Render Node/Express: https://render.com/docs/deploy-node-express-app
-   Sentry JavaScript/Node documentation:
    https://docs.sentry.io/platforms/javascript/
