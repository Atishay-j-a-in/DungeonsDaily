import {
  DungeonMasterOutputSchema,
  type DungeonMasterInput,
  type DungeonMasterOutput,
} from "@dungeonsdaily/shared";
import { hasGemma } from "../../config/env.js";
import { Sentry, setTraceAttributes, trace } from "../../observability/sentry.js";
import { FakeDungeonMaster, deterministicFallback } from "./fake-dm.js";
import { GemmaService } from "./gemma.service.js";
import { GEMMA_MODEL_ID, GEMMA_PROVIDER } from "./provider.js";
import type { DungeonMasterModel } from "./types.js";

// Orchestrates: Gemma -> Zod validation -> 1 repair retry -> fallback (guide §4).
// Returns degradation metadata alongside the output so callers (and the UI)
// can tell live Gemma narration apart from the deterministic fallback.
// Retry budget: at most 2 model calls per generateValidatedTurn (initial +
// one repair), on top of the SDK's single internal retry.
export type ValidatedTurn = {
  output: DungeonMasterOutput;
  provider: string;
  degraded: boolean;
  reason: string | null;
};

export class DungeonMasterService {
  private model: DungeonMasterModel;

  constructor(model?: DungeonMasterModel) {
    if (model) {
      this.model = model;
    } else {
      this.model = hasGemma ? new GemmaService() : new FakeDungeonMaster();
    }
  }

  get provider(): string {
    if (this.model instanceof GemmaService)
      return `${GEMMA_PROVIDER}:${GEMMA_MODEL_ID}`;
    return "fake-deterministic";
  }

  async generateValidatedTurn(
    input: DungeonMasterInput,
  ): Promise<ValidatedTurn> {
    return trace("dm.generate", { model: this.provider }, async () => {
      const fail = (reason: unknown, retryCount: number): ValidatedTurn => {
        const message =
          reason instanceof Error ? reason.message : String(reason);
        // Visible in the API terminal — previously these failures were
        // completely silent, which made "same fallback line every turn"
        // impossible to diagnose. Never includes API keys.
        console.warn(`[dm] ${this.provider} failed, using fallback: ${message}`);
        setTraceAttributes({ validationFailed: true, retryCount: retryCount });
        try {
          Sentry.captureMessage(`DM fallback used: ${message.slice(0, 200)}`, "warning");
        } catch {
          // Observability must never break gameplay.
        }
        return {
          output: deterministicFallback(),
          provider: this.provider,
          degraded: true,
          reason: message.slice(0, 300),
        };
      };
      const ok = (output: DungeonMasterOutput): ValidatedTurn => ({
        output,
        provider: this.provider,
        degraded: false,
        reason: null,
      });
      try {
        const raw = await this.model.generateTurn(input);
        const parsed = DungeonMasterOutputSchema.safeParse(raw);
        if (parsed.success) return ok(parsed.data);
        // Repair retry: ask once more (same input; adapter re-prompts).
        const retry = await this.model.generateTurn(input);
        const reparsed = DungeonMasterOutputSchema.safeParse(retry);
        if (reparsed.success) return ok(reparsed.data);
        return fail(
          `invalid Gemma output: ${reparsed.error.issues[0]?.message ?? "schema mismatch"}`,
          1,
        );
      } catch (err) {
        try {
          const retry = await this.model.generateTurn(input);
          const reparsed = DungeonMasterOutputSchema.safeParse(retry);
          if (reparsed.success) return ok(reparsed.data);
          return fail(err, 1);
        } catch (retryErr) {
          return fail(retryErr instanceof Error ? retryErr : err, 1);
        }
      }
    });
  }
}
