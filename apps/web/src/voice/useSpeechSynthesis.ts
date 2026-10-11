import { useCallback, useEffect, useRef, useState } from "react";

export interface TtsSettings {
  voiceURI?: string;
  rate: number;
  pitch: number;
  volume: number;
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  rate: 1,
  pitch: 1,
  volume: 1,
};

interface UseSpeechSynthesisOptions {
  settings?: Partial<TtsSettings>;
  /** Called when an utterance finishes (or immediately if TTS is unavailable). */
  onEnd?: () => void;
  onError?: (message: string) => void;
}

function pickEnglishVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const exact = voices.find(
    (v) => v.lang.toLowerCase() === "en-us" && v.default,
  );
  if (exact) return exact;
  const enUs = voices.find((v) => v.lang.toLowerCase().startsWith("en-us"));
  if (enUs) return enUs;
  const enDefault = voices.find(
    (v) => v.lang.toLowerCase().startsWith("en") && v.default,
  );
  if (enDefault) return enDefault;
  const en = voices.find((v) => v.lang.toLowerCase().startsWith("en"));
  if (en) return en;
  const def = voices.find((v) => v.default);
  return def ?? voices[0] ?? null;
}

/**
 * Browser-native TTS via window.speechSynthesis. No audio is sent to or
 * stored on the backend. Never overlaps utterances: each speak() cancels
 * any active speech first. Gameplay never blocks on TTS failure.
 */
export function useSpeechSynthesis(options: UseSpeechSynthesisOptions = {}) {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [settings, setSettings] = useState<TtsSettings>({
    ...DEFAULT_TTS_SETTINGS,
    ...options.settings,
  });
  const [isSpeaking, setIsSpeaking] = useState(false);

  const onEndRef = useRef(options.onEnd);
  onEndRef.current = options.onEnd;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const targetEnergyRef = useRef(0);
  const smoothedEnergyRef = useRef(0);

  const getVoiceEnergy = useCallback((): number => {
    if (!isSpeaking) {
      smoothedEnergyRef.current *= 0.8;
      if (smoothedEnergyRef.current < 0.01) smoothedEnergyRef.current = 0;
      return smoothedEnergyRef.current;
    }
    const now = performance.now();
    // Natural human speech cadence: 4-6Hz syllable frequency modulation
    const speechCadence =
      0.45 +
      0.35 * Math.sin(now * 0.022) * Math.cos(now * 0.011) +
      0.15 * Math.sin(now * 0.045);
    const target = Math.min(
      1.0,
      Math.max(0.3, speechCadence * 0.65 + targetEnergyRef.current * 0.55),
    );
    targetEnergyRef.current *= 0.93; // Exponential release after word boundary spike
    smoothedEnergyRef.current +=
      (target - smoothedEnergyRef.current) * 0.3;
    return Math.min(1.0, Math.max(0.0, smoothedEnergyRef.current));
  }, [isSpeaking]);

  // Voices load asynchronously in most browsers — refresh onvoiceschanged.
  useEffect(() => {
    if (!supported) return;
    const load = (): void => {
      const available = window.speechSynthesis.getVoices();
      if (available.length === 0) return;
      // Some browsers (Edge/Chrome) list the same voice twice — dedupe so
      // React keys and voice selection stay unambiguous.
      const seen = new Set<string>();
      setVoices(
        available.filter((v) => {
          const id = `${v.voiceURI}::${v.name}::${v.lang}`;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        }),
      );
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      if (window.speechSynthesis.onvoiceschanged === load) {
        window.speechSynthesis.onvoiceschanged = null;
      }
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    };
  }, [supported]);

  const finishSpeaking = useCallback(() => {
    setIsSpeaking(false);
    utteranceRef.current = null;
    onEndRef.current?.();
  }, []);

  const speak = useCallback(
    (text: string): void => {
      if (!supported) {
        onErrorRef.current?.("Speech synthesis is not supported in this browser.");
        // Never block the game: report "ended" so the loop can continue.
        onEndRef.current?.();
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) {
        onEndRef.current?.();
        return;
      }
      // Prevent overlap: cancel anything currently speaking first.
      window.speechSynthesis.cancel();
      utteranceRef.current = null;

      const utterance = new SpeechSynthesisUtterance(trimmed);
      const available =
        voices.length > 0 ? voices : window.speechSynthesis.getVoices();
      const chosen =
        (settings.voiceURI
          ? available.find((v) => v.voiceURI === settings.voiceURI)
          : undefined) ?? pickEnglishVoice(available);
      if (chosen) utterance.voice = chosen;
      utterance.rate = settings.rate;
      utterance.pitch = settings.pitch;
      utterance.volume = settings.volume;
      utterance.onboundary = () => {
        targetEnergyRef.current = 1.0;
      };
      utterance.onend = finishSpeaking;
      utterance.onerror = () => {
        setIsSpeaking(false);
        utteranceRef.current = null;
        onErrorRef.current?.("Speech synthesis failed; continuing without voice.");
        // TTS failure must never block the game.
        onEndRef.current?.();
      };
      targetEnergyRef.current = 0.9;
      utteranceRef.current = utterance;
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [finishSpeaking, settings, supported, voices],
  );

  const stop = useCallback((): void => {
    if (!supported) return;
    utteranceRef.current = null;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [supported]);

  const pause = useCallback((): void => {
    if (supported && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
    }
  }, [supported]);

  const resume = useCallback((): void => {
    if (supported && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }, [supported]);

  const updateSettings = useCallback((patch: Partial<TtsSettings>): void => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return {
    supported,
    voices,
    preferredVoice: pickEnglishVoice(voices),
    settings,
    updateSettings,
    speak,
    stop,
    pause,
    resume,
    isSpeaking,
    getVoiceEnergy,
  };
}
