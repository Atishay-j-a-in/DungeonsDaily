import type { Exercise } from "@dungeonsdaily/shared";

// Deterministic exercise catalog (guide §7). Equipment-free only.

export const EXERCISE_CATALOG: Exercise[] = [
  { id: "squats", name: "Squats", category: "strength", difficulty: "easy", defaultReps: 10, equipment: "none" },
  { id: "lunges", name: "Lunges", category: "strength", difficulty: "medium", defaultReps: 8, equipment: "none" },
  { id: "jumping_jacks", name: "Jumping Jacks", category: "cardio", difficulty: "easy", defaultDurationSeconds: 30, equipment: "none" },
  { id: "high_knees", name: "High Knees", category: "cardio", difficulty: "medium", defaultDurationSeconds: 30, equipment: "none" },
  { id: "mountain_climbers", name: "Mountain Climbers", category: "cardio", difficulty: "hard", defaultDurationSeconds: 30, equipment: "none" },
  { id: "push_ups", name: "Push-ups", category: "strength", difficulty: "medium", defaultReps: 8, equipment: "none" },
  { id: "wall_sit", name: "Wall Sit", category: "strength", difficulty: "medium", defaultDurationSeconds: 30, equipment: "none" },
  { id: "plank", name: "Plank", category: "core", difficulty: "medium", defaultDurationSeconds: 30, equipment: "none" },
  { id: "standing_knee_raises", name: "Standing Knee Raises", category: "mobility", difficulty: "easy", defaultReps: 10, equipment: "none" },
  { id: "calf_raises", name: "Bodyweight Calf Raises", category: "strength", difficulty: "easy", defaultReps: 12, equipment: "none" },
];

export function findExercise(id: string): Exercise | undefined {
  return EXERCISE_CATALOG.find((e) => e.id === id);
}
