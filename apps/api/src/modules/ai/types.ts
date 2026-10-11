import type {
  DungeonMasterInput,
  DungeonMasterOutput,
} from "@dungeonsdaily/shared";

// Gemma is the open-weight AI core. Everything model-specific stays behind
// this interface so the engine never imports an SDK directly (guide §3).
export interface DungeonMasterModel {
  generateTurn(input: DungeonMasterInput): Promise<DungeonMasterOutput>;
}
