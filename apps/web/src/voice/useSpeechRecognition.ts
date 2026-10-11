import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SpeechRecognitionErrorEventLike,
  SpeechRecognitionEventLike,
  SpeechRecognitionLike,
} from "./speech-types.js";

export type SttErrorCode =
  | "unsupported"
  | "permission-denied"
  | "no-speech"
  | "network"
  | "audio-capture"
  | "aborted"
  | "unknown";

export const isBraveBrowser = (): boolean => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return (
    typeof (navigator as any).brave !== "undefined" ||
    /Brave/i.test(navigator.userAgent)
  );
};

export const getSttErrorMessage = (code: SttErrorCode): string => {
  const isBrave = isBraveBrowser();
  switch (code) {
    case "unsupported":
      return "Speech recognition isn't supported in this browser. Type your response below.";
    case "permission-denied":
      return isBrave
        ? "Microphone access blocked. Click the Brave shield icon or allow mic in brave://settings/content/microphone, or type below."
        : "Microphone permission is required for voice input. Allow mic or type below.";
    case "no-speech":
      return "No speech was detected. Speak clearly or type below.";
    case "network":
      return isBrave
        ? "Brave blocks speech-to-text by default. To enable: go to brave://settings/privacy and turn ON 'Use Google services for speech recognition', or type below."
        : "Couldn't reach the browser speech recognition service. Check your connection or type below.";
    case "audio-capture":
      return "No microphone signal detected. Check that your mic is plugged in, or type below.";
    case "aborted":
      return "Listening stopped.";
    default:
      return "Speech recognition unavailable. You can type your response below.";
  }
};

interface UseSpeechRecognitionOptions {
  lang?: string;
  /** Fired exactly once per final transcript (caller dedupes + submits). */
  onFinal?: (transcript: string) => void;
}

/**
 * Browser-native STT via SpeechRecognition / webkitSpeechRecognition.
 * continuous=false, interimResults=true, lang=en-US. Stops automatically
 * when a final result arrives. Never sends audio anywhere: only the text
 * transcript leaves the browser, via the existing JSON response endpoint.
 *
 * NOTE: browser SpeechRecognition is NOT guaranteed to be offline/local —
 * it may use the browser/platform's speech service.
 */
export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
) {
  const lang = options.lang ?? "en-US";
  const supported =
    typeof window !== "undefined" &&
    (typeof window.SpeechRecognition === "function" ||
      typeof window.webkitSpeechRecognition === "function");

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<SttErrorCode | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(options.onFinal);
  onFinalRef.current = options.onFinal;
  const finalDeliveredRef = useRef<string | null>(null);

  const teardown = useCallback(() => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // Already stopped — safe to ignore.
      }
    }
  }, []);

  // Unmount cleanup: stop recognition + drop listeners.
  useEffect(() => teardown, [teardown]);

  const mapRecognitionError = useCallback(
    (event: SpeechRecognitionErrorEventLike): SttErrorCode => {
      switch (event.error) {
        case "not-allowed":
        case "service-not-allowed":
          return "permission-denied";
        case "no-speech":
          return "no-speech";
        case "network":
          return "network";
        case "audio-capture":
          return "audio-capture";
        case "aborted":
          return "aborted";
        default:
          return "unknown";
      }
    },
    [],
  );

  const startListening = useCallback((): void => {
    if (!supported) {
      setError("unsupported");
      return;
    }
    // Never stack recognizers.
    if (recognitionRef.current) return;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setError("unsupported");
      return;
    }
    setError(null);
    setTranscript("");
    setInterimTranscript("");
    finalDeliveredRef.current = null;

    const recognition: SpeechRecognitionLike = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += text;
        else interim += text;
      }
      if (interim) setInterimTranscript(interim);
      if (finalText.trim()) {
        const cleaned = finalText.trim();
        setTranscript(cleaned);
        setInterimTranscript("");
        // Guard against duplicate onresult delivery for the same text.
        if (finalDeliveredRef.current !== cleaned) {
          finalDeliveredRef.current = cleaned;
          try {
            recognition.stop();
          } catch {
            // Already stopping — ignore.
          }
          onFinalRef.current?.(cleaned);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      // eslint-disable-next-line no-console
      console.warn("[stt] recognition error:", event.error, event.message);
      setError(mapRecognitionError(event));
      setIsListening(false);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    const startActual = () => {
      try {
        recognition.start();
        setIsListening(true);
      } catch {
        recognitionRef.current = null;
        setIsListening(false);
        setError("unknown");
      }
    };

    if (
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
    ) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach((track) => track.stop());
          startActual();
        })
        .catch((err) => {
          if (
            err.name === "NotAllowedError" ||
            err.name === "PermissionDeniedError"
          ) {
            setError("permission-denied");
          } else {
            startActual();
          }
        });
    } else {
      startActual();
    }
  }, [lang, mapRecognitionError, supported]);

  const stopListening = useCallback((): void => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // Already stopped — ignore.
      }
    }
    setIsListening(false);
  }, []);

  const resetTranscript = useCallback((): void => {
    setTranscript("");
    setInterimTranscript("");
    setError(null);
    finalDeliveredRef.current = null;
  }, []);

  return {
    supported,
    isListening,
    transcript,
    interimTranscript,
    error,
    errorMessage: error ? getSttErrorMessage(error) : null,
    startListening,
    stopListening,
    resetTranscript,
  };
}
