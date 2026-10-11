// Pluggable STT abstraction (guide §15). Browser STT is the MVP fallback;
// a real provider implements this interface later without touching the engine.
export interface SpeechToTextService {
  transcribe(audio: Buffer, mimeType: string): Promise<string>;
}

export class UnsupportedSpeechToText implements SpeechToTextService {
  async transcribe(): Promise<string> {
    const err = new Error(
      "Server STT not configured — use browser speech recognition or text input",
    ) as Error & { code: string };
    err.code = "STT_FAILED";
    throw err;
  }
}
