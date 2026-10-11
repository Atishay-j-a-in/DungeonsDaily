export interface TextToSpeechService {
  synthesize(text: string): Promise<Buffer>;
}
