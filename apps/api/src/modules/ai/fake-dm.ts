import type {
  DungeonMasterInput,
  DungeonMasterOutput,
} from "@dungeonsdaily/shared";
import type { DungeonMasterModel } from "./types.js";

type Beat = {
  narration: string;
  mood: DungeonMasterOutput["mood"];
  environment: DungeonMasterOutput["scene"]["environment"];
  ambientSounds: string[];
  soundEffects: string[];
  action:
    | {
        type: "exercise";
        exerciseId: string;
        reps?: number;
        durationSeconds?: number;
        prompt: string;
      }
    | { type: "choice" | "narrate"; prompt: string };
  responseExpectation: DungeonMasterOutput["responseExpectation"];
};

// A mini-campaign arc so the offline stand-in tells a progressing story
// instead of repeating one template. Indexed by turn number (always
// advances), with exercise variety, scene changes, and rest/riddle beats.
// The game engine works fully without any AI (guide Phase 4).
const BEATS: Beat[] = [
  {
    narration:
      "You stand at the entrance of the Forgotten Dungeon. Torchlight flickers on damp stone.",
    mood: "mysterious",
    environment: "dungeon",
    ambientSounds: ["fire", "footsteps"],
    soundEffects: ["door"],
    action: {
      type: "exercise",
      exerciseId: "squats",
      reps: 10,
      prompt: "Ten squats to force the rusted portcullis open.",
    },
    responseExpectation: "exercise_completion",
  },
  {
    narration:
      "The gate screeches upward. Beyond lies a trapped corridor, pressure plates glinting between the flagstones.",
    mood: "tense",
    environment: "dungeon",
    ambientSounds: ["wind", "footsteps"],
    soundEffects: ["branch_snap"],
    action: {
      type: "exercise",
      exerciseId: "jumping_jacks",
      durationSeconds: 30,
      prompt: "Thirty seconds of jumping jacks to dance across the plates untouched.",
    },
    responseExpectation: "exercise_completion",
  },
  {
    narration:
      "You tumble through a collapsed wall into a flooded cavern. Something pale ripples beneath the black water.",
    mood: "mysterious",
    environment: "cave",
    ambientSounds: ["cave", "water"],
    soundEffects: [],
    action: {
      type: "exercise",
      exerciseId: "standing_knee_raises",
      reps: 10,
      prompt: "Ten high knee raises to wade through the icy current.",
    },
    responseExpectation: "exercise_completion",
  },
  {
    narration:
      "Torchlight catches eyes in the dark — cave wolves, circling. They lunge as one!",
    mood: "combat",
    environment: "cave",
    ambientSounds: ["wind"],
    soundEffects: ["monster_growl"],
    action: {
      type: "exercise",
      exerciseId: "push_ups",
      reps: 8,
      prompt: "Eight push-ups to hurl the alpha back into the shadows.",
    },
    responseExpectation: "exercise_completion",
  },
  {
    narration:
      "A moss-covered door bars the old ruins. Carved runes pulse: answer the riddle, or break through by force?",
    mood: "mysterious",
    environment: "ruins",
    ambientSounds: ["wind"],
    soundEffects: ["door_creak"],
    action: {
      type: "choice",
      prompt: "Speak your answer to the runes, or tell me you force the door.",
    },
    responseExpectation: "user_speech",
  },
  {
    narration:
      "The ruins burst open into moonlit forest. Behind you, goblin drums pound closer through the trees.",
    mood: "danger",
    environment: "forest",
    ambientSounds: ["forest", "wind", "birds"],
    soundEffects: ["branch_snap"],
    action: {
      type: "exercise",
      exerciseId: "high_knees",
      durationSeconds: 30,
      prompt: "Thirty seconds of high knees to outrun the war party.",
    },
    responseExpectation: "exercise_completion",
  },
  {
    narration:
      "Dawn reveals a scorched battlefield. A wounded knight points to the ridge: the enemy standard still flies.",
    mood: "combat",
    environment: "battlefield",
    ambientSounds: ["wind"],
    soundEffects: ["sword_swing"],
    action: {
      type: "exercise",
      exerciseId: "lunges",
      reps: 8,
      prompt: "Eight lunges to charge the ridge and seize the standard.",
    },
    responseExpectation: "exercise_completion",
  },
  {
    narration:
      "The standard falls. Around a crackling campfire, the survivors share bread and silence. Breathe, hero.",
    mood: "calm",
    environment: "village",
    ambientSounds: ["village", "fire"],
    soundEffects: [],
    action: {
      type: "narrate",
      prompt: "Rest a moment, then tell me where your quest leads next.",
    },
    responseExpectation: "user_speech",
  },
  {
    narration:
      "A shadow blots out the sun — a young dragon coils around the mountain pass, smoke curling from its jaws.",
    mood: "danger",
    environment: "mountain",
    ambientSounds: ["wind", "thunder"],
    soundEffects: ["dragon_roar"],
    action: {
      type: "exercise",
      exerciseId: "mountain_climbers",
      durationSeconds: 30,
      prompt: "Thirty seconds of mountain climbers to scale the rocks above its reach.",
    },
    responseExpectation: "exercise_completion",
  },
  {
    narration:
      "From the heights you rain stones onto the beast. It shrieks and flees, and the castle gates swing open below.",
    mood: "victorious",
    environment: "castle",
    ambientSounds: ["wind", "rain"],
    soundEffects: ["level_up"],
    action: {
      type: "exercise",
      exerciseId: "wall_sit",
      durationSeconds: 30,
      prompt: "A thirty-second wall sit to hold the gate against its final thrash.",
    },
    responseExpectation: "exercise_completion",
  },
  {
    narration:
      "Inside the vault, gold glitters ankle-deep — but the floor is waking. The treasure defends itself.",
    mood: "tense",
    environment: "cave",
    ambientSounds: ["cave", "water"],
    soundEffects: ["coin"],
    action: {
      type: "exercise",
      exerciseId: "calf_raises",
      reps: 12,
      prompt: "Twelve calf raises to snatch the relic from the shifting hoard.",
    },
    responseExpectation: "exercise_completion",
  },
  {
    narration:
      "Relic in hand, the dungeon reshapes itself around you — new halls, new hungers. The adventure continues.",
    mood: "tense",
    environment: "dungeon",
    ambientSounds: ["dungeon", "fire"],
    soundEffects: ["door_creak"],
    action: {
      type: "exercise",
      exerciseId: "plank",
      durationSeconds: 30,
      prompt: "Hold a thirty-second plank as the walls grind into a new labyrinth.",
    },
    responseExpectation: "exercise_completion",
  },
];

const COMPLETION_WORDS = /done|did it|finished|complete|crushed|nailed it/i;

function lastUserText(input: DungeonMasterInput): string {
  for (let i = input.recentTurns.length - 1; i >= 0; i -= 1) {
    const turn = input.recentTurns[i];
    if (turn?.speaker === "user") return turn.text;
  }
  return "";
}

// Deterministic stand-in used for tests and when no GOOGLE_GENERATIVE_AI_API_KEY
// is set. Story always advances with the turn number and acknowledges
// completed exercises — never the same template twice in a row.
export class FakeDungeonMaster implements DungeonMasterModel {
  async generateTurn(input: DungeonMasterInput): Promise<DungeonMasterOutput> {
    const beat = BEATS[input.turnNumber % BEATS.length] ?? BEATS[0]!;
    const userText = lastUserText(input);
    const completedSomething =
      COMPLETION_WORDS.test(userText) && input.completedExercises.length > 0;

    const narration = completedSomething
      ? `Well done — the magic settles. ${beat.narration}`
      : beat.narration;

    if (beat.action.type === "exercise") {
      return {
        narration,
        mood: beat.mood,
        scene: {
          environment: beat.environment,
          ambientSounds: beat.ambientSounds,
          soundEffects: beat.soundEffects,
        },
        action: {
          type: "exercise",
          exerciseId: beat.action.exerciseId,
          ...(beat.action.reps ? { reps: beat.action.reps } : {}),
          ...(beat.action.durationSeconds
            ? { durationSeconds: beat.action.durationSeconds }
            : {}),
          prompt: beat.action.prompt,
        },
        responseExpectation: beat.responseExpectation,
        stateChanges: { xp: 10, healthDelta: 0 },
      };
    }
    return {
      narration,
      mood: beat.mood,
      scene: {
        environment: beat.environment,
        ambientSounds: beat.ambientSounds,
        soundEffects: beat.soundEffects,
      },
      action: { type: beat.action.type, prompt: beat.action.prompt },
      responseExpectation: beat.responseExpectation,
      stateChanges: { xp: 5, healthDelta: 0 },
    };
  }
}

/** Last-resort deterministic response when Gemma output is unusable. */
export function deterministicFallback(): DungeonMasterOutput {
  return {
    narration:
      "The torches gutter for a moment, then steady. Catch your breath, hero — the dungeon waits.",
    mood: "calm",
    scene: {
      environment: "dungeon",
      ambientSounds: ["fire"],
      soundEffects: [],
    },
    action: {
      type: "narrate",
      prompt: "Take a breath and tell me when you are ready.",
    },
    responseExpectation: "user_speech",
    stateChanges: { xp: 0, healthDelta: 0 },
  };
}
