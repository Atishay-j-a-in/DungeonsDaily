// One-shot sound effects for the backend's `soundEffects` IDs. The DM turn
// carries IDs from the engine allowlist (scene-engine.ts); this engine maps
// them onto the real files in /public. IDs with no asset stay silent — a
// missing file must never break the game or the narration.

const SFX_FILES: Record<string, string> = {
  dragon_roar: "/dragon-roar.mp3",
  monster_growl: "/wolf-growl.mp3",
  wolf_growl: "/wolf-growl.mp3",
  magic: "/spell-cast.mp3",
  heal_chime: "/spell-cast.mp3",
  victory_horn: "/spell-cast.mp3",
  level_up: "/spell-cast.mp3",
  thunder: "/thunder.mp3",
  explosion: "/thunder.mp3",
  // Percussive impacts; no blade assets ship, thunder reads as the hit.
  sword_hit: "/thunder.mp3",
  sword_clash: "/thunder.mp3",
  shield_hit: "/thunder.mp3",
};

const MAX_PER_TURN = 2;
const STAGGER_MS = 140;
const SFX_VOLUME = 0.5;
const MUTE_KEY = "dd-muted";

export class SfxEngine {
  private cache = new Map<string, HTMLAudioElement>();
  muted: boolean;

  constructor() {
    try {
      this.muted = window.localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      this.muted = false;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // Persistence is a nicety, not a requirement.
    }
  }

  /** Play up to MAX_PER_TURN effects, staggered so impacts don't stack. */
  play(ids: readonly string[] | undefined): void {
    if (this.muted || !ids || ids.length === 0) return;
    try {
      const files: string[] = [];
      for (const id of ids) {
        const file = SFX_FILES[id];
        if (file && !files.includes(file) && files.length < MAX_PER_TURN) {
          files.push(file);
        }
      }
      files.forEach((file, index) => {
        window.setTimeout(() => this.playFile(file), index * STAGGER_MS);
      });
    } catch {
      // Decorative audio never breaks the game.
    }
  }

  private playFile(file: string): void {
    if (this.muted) return;
    try {
      let audio = this.cache.get(file);
      if (!audio) {
        audio = new Audio(file);
        audio.volume = SFX_VOLUME;
        audio.preload = "auto";
        this.cache.set(file, audio);
      }
      audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    } catch {
      // Ignore.
    }
  }
}
