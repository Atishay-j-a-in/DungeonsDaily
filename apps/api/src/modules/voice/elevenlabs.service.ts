import { env, hasElevenLabs } from "../../config/env.js";
import type { TextToSpeechService } from "./voice.types.js";

// ElevenLabs adapter. Route handlers must use this service, never call
// ElevenLabs directly (guide §13). TTS failure must not break gameplay.
export class ElevenLabsService implements TextToSpeechService {
  async synthesize(text: string): Promise<Buffer> {
    if (!hasElevenLabs) {
      const err = new Error(
        "ElevenLabs not configured — set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID",
      ) as Error & { code: string };
      err.code = "TTS_FAILED";
      throw err;
    }
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${env.elevenlabsVoiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": env.elevenlabsApiKey,
        },
        body: JSON.stringify({
          text,
          model_id: env.elevenlabsModelId,
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(
        `ElevenLabs TTS failed (${res.status}): ${body.slice(0, 200)}`,
      ) as Error & { code: string };
      err.code = "TTS_FAILED";
      throw err;
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
