export type AdventureState = {
  sessionId: string;
  userId: string;
  durationMinutes: 10 | 20 | 30;
  status:
    | "created"
    | "active"
    | "paused"
    | "completed"
    | "abandoned";
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

export type AppErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_ACTIVE"
  | "INVALID_DURATION"
  | "INVALID_EXERCISE"
  | "INVALID_DM_OUTPUT"
  | "AI_GENERATION_FAILED"
  | "TTS_FAILED"
  | "STT_FAILED"
  | "DATABASE_ERROR"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";
