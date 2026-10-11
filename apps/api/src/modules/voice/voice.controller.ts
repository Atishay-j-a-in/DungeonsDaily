import { Router } from "express";
import { SynthesizeRequestSchema } from "@dungeonsdaily/shared";

// Server-side TTS is intentionally DISABLED. Voice output is handled by the
// browser's native speechSynthesis; no audio is sent to or stored on the
// backend, and no paid voice service (ElevenLabs) is used.
//
// The route path is kept so existing clients get a clear, actionable
// message instead of a bare 404. The game never depends on this endpoint:
// POST /api/v1/sessions/:id/response already carries text from either
// typed input or browser SpeechRecognition through the same pipeline.

export function voiceRouter(): Router {
  const router = Router();

  router.post("/synthesize", (req, res) => {
    const parsed = SynthesizeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      });
    }
    return res.status(410).json({
      error: {
        code: "TTS_DISABLED",
        message:
          "Server TTS is disabled: the browser speaks DM narration with speechSynthesis. Display the narration text and continue the game.",
      },
    });
  });

  return router;
}
