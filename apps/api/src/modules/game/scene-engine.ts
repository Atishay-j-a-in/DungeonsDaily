// Scene / audio-environment registry.
// Gemma may ONLY return these predefined audio IDs — never URLs, file
// paths, or arbitrary filenames. Unknown IDs are stripped (rejected) here
// so they can never reach the client or the frontend sound library.

export const ALLOWED_AMBIENT_SOUNDS: readonly string[] = [
  "forest",
  "dungeon",
  "cave",
  "village",
  "wind",
  "rain",
  "fire",
  "birds",
  "water",
  // Legacy engine IDs (kept valid so older turns stay playable):
  "cave_drips",
  "distant_roar",
  "distant_birds",
  "footsteps",
  "branch_snap",
  "chains",
  "door",
  "monster_growl",
];

export const ALLOWED_SFX: readonly string[] = [
  "sword_swing",
  "sword_hit",
  "shield_hit",
  "footsteps",
  "door_creak",
  "branch_snap",
  "magic",
  "monster_growl",
  "dragon_roar",
  "explosion",
  "coin",
  "level_up",
  "heartbeat",
  "thunder",
  // Legacy engine IDs (kept valid):
  "wolf_growl",
  "sword_clash",
  "door",
  "fire",
  "victory_horn",
  "heal_chime",
];

export function isAllowedAmbientSound(id: string): boolean {
  return ALLOWED_AMBIENT_SOUNDS.includes(id);
}

export function isAllowedSfx(id: string): boolean {
  return ALLOWED_SFX.includes(id);
}

export const ENVIRONMENTS = [
  "forest",
  "cave",
  "dungeon",
  "castle",
  "village",
  "battlefield",
  "mountain",
  "ruins",
] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

const AMBIENT_WHITELIST: Record<Environment, string[]> = {
  forest: ["forest", "rain", "wind", "birds", "water", "footsteps", "branch_snap", "distant_birds"],
  cave: ["cave", "cave_drips", "wind", "distant_roar", "footsteps", "water"],
  dungeon: ["dungeon", "chains", "fire", "footsteps", "door", "monster_growl"],
  castle: ["fire", "footsteps", "door", "wind", "rain"],
  village: ["village", "birds", "wind", "footsteps", "fire", "water"],
  battlefield: ["wind", "distant_roar", "footsteps", "fire", "thunder", "explosion"],
  mountain: ["wind", "footsteps", "distant_roar", "rain", "thunder"],
  ruins: ["wind", "cave_drips", "footsteps", "chains", "branch_snap", "birds"],
};

const SFX_WHITELIST = ALLOWED_SFX;

export function sanitizeScene(scene: {
  environment?: string;
  ambientSounds?: string[];
  soundEffects?: string[];
  music?: string;
}): {
  environment: Environment;
  ambientSounds: string[];
  soundEffects: string[];
  music?: string;
} {
  const environment = (ENVIRONMENTS as readonly string[]).includes(
    scene.environment ?? "",
  )
    ? (scene.environment as Environment)
    : ("dungeon" as Environment);
  const allowedAmbient = new Set(AMBIENT_WHITELIST[environment]);
  const allowedSfx = new Set<string>(SFX_WHITELIST as unknown as string[]);
  return {
    environment,
    ambientSounds: (scene.ambientSounds ?? [])
      .filter((s) => allowedAmbient.has(s))
      .slice(0, 5),
    soundEffects: (scene.soundEffects ?? [])
      .filter((s) => allowedSfx.has(s))
      .slice(0, 5),
    ...(scene.music ? { music: String(scene.music).slice(0, 80) } : {}),
  };
}
