import { describe, expect, it } from "vitest";
import {
  ALLOWED_AMBIENT_SOUNDS,
  ALLOWED_SFX,
  isAllowedAmbientSound,
  isAllowedSfx,
} from "../src/modules/game/scene-engine.js";
import { sanitizeScene } from "../src/modules/game/scene-engine.js";

describe("audio registry", () => {
  it("contains the spec ambient + SFX ids", () => {
    for (const id of ["forest", "wind", "rain", "fire", "birds", "water"]) {
      expect(ALLOWED_AMBIENT_SOUNDS).toContain(id);
    }
    for (const id of [
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
    ]) {
      expect(ALLOWED_SFX).toContain(id);
    }
  });

  it("rejects unknown audio ids", () => {
    expect(isAllowedAmbientSound("https://evil.example/x.mp3")).toBe(false);
    expect(isAllowedAmbientSound("/etc/passwd")).toBe(false);
    expect(isAllowedSfx("arbitrary_file.wav")).toBe(false);
    expect(isAllowedSfx("http://evil.example/sfx.mp3")).toBe(false);
  });

  it("strips unknown ids from scene output", () => {
    const scene = sanitizeScene({
      environment: "dungeon",
      ambientSounds: ["dungeon", "https://evil.example/x.mp3", "nope"],
      soundEffects: ["sword_hit", "evil.exe"],
    });
    expect(scene.ambientSounds).toEqual(["dungeon"]);
    expect(scene.soundEffects).toEqual(["sword_hit"]);
  });

  it("keeps valid spec ids and falls back to dungeon for unknown envs", () => {
    const scene = sanitizeScene({
      environment: "mordor",
      ambientSounds: ["wind", "thunder"],
      soundEffects: ["dragon_roar", "coin", "level_up"],
    });
    expect(scene.environment).toBe("dungeon");
    expect(scene.soundEffects).toEqual(["dragon_roar", "coin", "level_up"]);
  });
});
