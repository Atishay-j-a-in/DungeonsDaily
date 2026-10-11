import { useCallback, useEffect, useRef, useState } from "react";
import { OrbCanvas, type OrbState } from "./components/OrbCanvas.js";
import { EnvironmentAudio } from "./voice/environmentAudio.js";
import { SfxEngine } from "./voice/sfx.js";
import { useSpeechRecognition } from "./voice/useSpeechRecognition.js";
import { useSpeechSynthesis } from "./voice/useSpeechSynthesis.js";

const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:4000";

type MicState = "IDLE" | "LISTENING" | "PROCESSING" | "DM_SPEAKING" | "ERROR";

interface PlayerState {
  xp: number;
  health: number;
  level: number;
}

interface CurrentExercise {
  exerciseId: string;
  reps?: number;
  durationSeconds?: number;
  completed: boolean;
}

interface SessionView {
  sessionId: string;
  status: string;
  adventure: { title: string };
  player?: PlayerState;
  currentExercise?: CurrentExercise;
  lastNarration?: string;
  lastPrompt?: string;
  lastScene?: string;
  isExerciseTurn?: boolean;
  turnCount?: number;
}

interface DmAction {
  type: string;
  prompt?: string;
  exerciseId?: string;
  reps?: number;
  durationSeconds?: number;
}

interface DmTurn {
  narration: string;
  mood?: string;
  action?: DmAction;
  scene?: {
    environment?: string;
    ambientSounds?: string[];
    soundEffects?: string[];
  };
  ai?: { provider: string; degraded: boolean; reason: string | null };
}

interface TurnRecord {
  turnNumber: number;
  userInput?: { text?: string };
  dmOutput?: DmTurn;
}

interface SessionDocView {
  _id: string;
  status: string;
  adventure?: { title: string };
  player?: PlayerState;
  currentExercise?: CurrentExercise;
  completedExercises?: string[];
}

interface SessionPollData {
  session: SessionDocView;
  turns: TurnRecord[];
}

const STILL_KEY = "dd-still-orb";

function prefersStill(): boolean {
  try {
    return (
      window.localStorage.getItem(STILL_KEY) === "1" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

function orbStateFor(micState: MicState, completed: boolean): OrbState {
  if (completed || micState === "IDLE") return "idle";
  if (micState === "ERROR") return "error";
  if (micState === "DM_SPEAKING") return "speaking";
  if (micState === "LISTENING") return "listening";
  return "thinking";
}

function orbCaptionFor(micState: MicState, completed: boolean): string {
  if (completed) return "The adventure rests. Begin anew when ready.";
  switch (micState) {
    case "LISTENING":
      return "The orb listens. Speak your action.";
    case "PROCESSING":
      return "The Dungeon Master consults the dark.";
    case "DM_SPEAKING":
      return "The Dungeon Master speaks.";
    case "ERROR":
      return "The connection wavers. Tap Speak or type below.";
    default:
      return "Tap Speak to address the Dungeon Master.";
  }
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: { code?: string; message?: string };
  };
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  return data;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: { code?: string; message?: string };
  };
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  return data;
}

/** Spoken text for a DM turn: narration plus the action prompt. */
function spokenTextForTurn(turn: DmTurn): string {
  const parts = [turn.narration.trim()];
  const prompt = turn.action?.prompt?.trim();
  if (prompt && prompt !== turn.narration.trim()) parts.push(prompt);
  return parts.join(" ");
}

export function App() {
  const [userId, setUserId] = useState("hero-1");
  const [duration, setDuration] = useState<10 | 20 | 30>(10);
  const [session, setSession] = useState<SessionView | null>(null);
  const [input, setInput] = useState("I am ready");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [micState, setMicState] = useState<MicState>("IDLE");
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [aiDegraded, setAiDegraded] = useState<string | null>(null);
  const [mood, setMood] = useState("mysterious");
  const [muted, setMuted] = useState(false);
  const [stillOrb, setStillOrb] = useState<boolean>(prefersStill);

  // Refs mirror state for use inside speech callbacks (no stale closures).
  const sessionRef = useRef<SessionView | null>(null);
  sessionRef.current = session;
  const submittingRef = useRef(false);
  const submittedTextRef = useRef<string | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const listenRetriesRef = useRef(0);
  const pollGenRef = useRef(0);
  const lastTurnCountRef = useRef(0);
  const lastEnvRef = useRef("dungeon");
  const energyRef = useRef(0);
  const envAudioRef = useRef<EnvironmentAudio | null>(null);
  if (!envAudioRef.current) envAudioRef.current = new EnvironmentAudio();
  const sfxRef = useRef<SfxEngine | null>(null);
  if (!sfxRef.current) sfxRef.current = new SfxEngine();

  useEffect(() => {
    setMuted(sfxRef.current?.muted ?? false);
  }, []);

  function push(msg: string): void {
    setLog((l) => [...l.slice(-50), msg]);
  }

  const isSessionActive = useCallback(
    (): boolean => sessionRef.current?.status === "active",
    [],
  );

  const handleTtsEnd = useCallback((): void => {
    envAudioRef.current?.restore();
    const current = sessionRef.current;
    if (!current || current.status !== "active") {
      setMicState("IDLE");
      return;
    }
    // Main loop: DM_SPEAKING → LISTENING automatically.
    beginListeningRef.current?.();
  }, []);

  const handleTtsError = useCallback((message: string): void => {
    // TTS failure never blocks the game — the loop continues to listening.
    push(`TTS note: ${message}`);
  }, []);

  const tts = useSpeechSynthesis({
    onEnd: handleTtsEnd,
    onError: handleTtsError,
  });

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      const vEnergy = tts.getVoiceEnergy();
      const aEnergy = envAudioRef.current?.getEnergy() ?? 0;
      energyRef.current = Math.min(1, Math.max(vEnergy, aEnergy));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tts]);

  // -- async orchestration helpers ---------------------------------------
  // The backend processes turns asynchronously inside the Temporal
  // workflow: POST only delivers a Signal and returns at once. The loop
  // below polls GET /sessions/:id until the workflow's activities persist
  // the next turn, then the game continues exactly as before.

  const pollSession = useCallback(
    async (
      sessionId: string,
      isDone: (data: SessionPollData) => boolean,
      timeoutMs: number,
    ): Promise<SessionPollData | null> => {
      const gen = pollGenRef.current;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (pollGenRef.current !== gen) return null;
        try {
          const data = await getJson<SessionPollData>(
            `/api/v1/sessions/${sessionId}`,
          );
          if (isDone(data)) return data;
          if (data.session.status === "completed") return data;
        } catch (err) {
          push(`Poll note: ${(err as Error).message}`);
        }
        if (Date.now() >= deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    },
    [],
  );

  const adoptTurn = useCallback(
    (rec: TurnRecord, doc: SessionDocView, totalTurns: number): void => {
      const turn = rec.dmOutput;
      if (!turn) return;
      lastTurnCountRef.current = totalTurns;
      const scene = turn.scene?.environment ?? "dungeon";
      lastEnvRef.current = scene;
      if (turn.mood) setMood(turn.mood);
      // The DM's sound design lands here: ambient bed follows the scene,
      // one-shot effects punctuate the narration.
      sfxRef.current?.play(turn.scene?.soundEffects);
      const actionExercise =
        turn.action?.type === "exercise" && turn.action.exerciseId
          ? {
              exerciseId: turn.action.exerciseId,
              reps: turn.action.reps,
              durationSeconds: turn.action.durationSeconds,
              completed: false,
            }
          : undefined;
      setSession((prev) =>
        prev
          ? {
              ...prev,
              status: doc.status,
              player: doc.player ?? prev.player,
              currentExercise: doc.currentExercise ?? actionExercise,
              lastNarration: turn.narration,
              lastPrompt: turn.action?.prompt,
              lastScene: scene,
              isExerciseTurn: turn.action?.type === "exercise",
              turnCount: totalTurns,
            }
          : prev,
      );
      push(`DM: ${turn.narration}`);
      if (turn.ai?.degraded) {
        const note = `Live AI unreachable (${turn.ai.reason ?? "unknown error"}) — playing fallback dialogue. Check the API terminal.`;
        setAiDegraded(note);
        push(`AI note: ${note}`);
      } else {
        setAiDegraded(null);
      }
      if (doc.status !== "active") {
        finishSessionLocallyRef.current?.("The adventure has ended.");
        return;
      }
      speakTurnRef.current?.(spokenTextForTurn(turn), scene);
    },
    [],
  );

  const finishSessionLocallyRef = useRef<((message: string) => void) | null>(null);

  const submitTranscript = useCallback(
    async (text: string): Promise<void> => {
      const current = sessionRef.current;
      if (!current || current.status !== "active") return;
      // Prevent duplicate API calls from the same transcript.
      if (submittingRef.current) return;
      if (submittedTextRef.current === `${current.sessionId}:${text}`) return;
      submittingRef.current = true;
      submittedTextRef.current = `${current.sessionId}:${text}`;
      setMicState("PROCESSING");
      push(`You: ${text}`);
      try {
        await postJson<{ accepted: boolean }>(
          `/api/v1/sessions/${current.sessionId}/response`,
          { text },
        );
        // The workflow runs Gemma + engine asynchronously; wait for the turn.
        const baseline = lastTurnCountRef.current;
        const data = await pollSession(
          current.sessionId,
          (d) => d.turns.length > baseline,
          300000,
        );
        if (!data) {
          push("The Dungeon Master is taking too long. Tap the mic to retry.");
          setMicState("ERROR");
          return;
        }
        const rec = data.turns[data.turns.length - 1];
        if (rec) adoptTurn(rec, data.session, data.turns.length);
      } catch (err) {
        push(`Error: ${(err as Error).message}`);
        setMicState("ERROR");
        setVoiceNotice("Could not reach the Dungeon Master. Tap the mic to try again, or type below.");
      } finally {
        submittingRef.current = false;
      }
    },
    [adoptTurn, pollSession],
  );

  const handleFinalTranscript = useCallback(
    (text: string): void => {
      // Submitting stops recognition (it already auto-stopped on final).
      listenRetriesRef.current = 0;
      sttRef.current?.stopListening();
      void submitTranscript(text);
    },
    [submitTranscript],
  );

  const stt = useSpeechRecognition({ onFinal: handleFinalTranscript });
  const sttRef = useRef(stt);
  sttRef.current = stt;

  const beginListening = useCallback((): void => {
    if (!isSessionActive()) return;
    if (!sttRef.current.supported) {
      setMicState("IDLE");
      return;
    }
    // STT never starts while TTS is speaking; stop any stray speech first.
    tts.stop();
    sttRef.current.resetTranscript();
    sttRef.current.startListening();
    setMicState("LISTENING");
    setVoiceNotice(null);
  }, [isSessionActive, tts]);

  const beginListeningRef = useRef<(() => void) | null>(null);
  beginListeningRef.current = beginListening;

  const speakTurn = useCallback(
    (text: string, scene?: string): void => {
      if (!isSessionActive()) return;
      // TTS never overlaps: stop STT + cancel any active speech first.
      sttRef.current?.stopListening();
      if (scene) envAudioRef.current?.start(scene);
      envAudioRef.current?.duck();
      setMicState("DM_SPEAKING");
      tts.speak(text);
    },
    [isSessionActive, tts],
  );

  const speakTurnRef = useRef<((text: string, scene?: string) => void) | null>(
    null,
  );
  speakTurnRef.current = speakTurn;

  // Surface STT errors without breaking the session. Transient errors
  // (no-speech, network) get one automatic retry before falling back.
  useEffect(() => {
    if (!stt.error) return;
    if (stt.error === "aborted") return;
    const transient = stt.error === "no-speech" || stt.error === "network";
    if (
      transient &&
      listenRetriesRef.current < 1 &&
      sessionRef.current?.status === "active"
    ) {
      listenRetriesRef.current += 1;
      push(`Mic hiccup (${stt.error}) — retrying…`);
      retryTimerRef.current = window.setTimeout(() => {
        beginListeningRef.current?.();
      }, 900);
      return;
    }
    setMicState((prev) => (prev === "LISTENING" ? "IDLE" : prev));
    setVoiceNotice(stt.errorMessage);
  }, [stt.error, stt.errorMessage]);

  // -- session lifecycle -------------------------------------------------

  const clearSessionTimer = useCallback((): void => {
    if (sessionTimerRef.current !== null) {
      window.clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const finishSessionLocally = useCallback(
    (message: string): void => {
      clearSessionTimer();
      pollGenRef.current += 1;
      sttRef.current?.stopListening();
      tts.stop();
      envAudioRef.current?.stop();
      submittingRef.current = false;
      energyRef.current = 0;
      setMicState("IDLE");
      setSession((prev) => (prev ? { ...prev, status: "completed" } : prev));
      push(message);
    },
    [clearSessionTimer, tts],
  );
  finishSessionLocallyRef.current = finishSessionLocally;

  // Unmount cleanup: synthesis, recognition, timers, polls, audio.
  useEffect(
    () => () => {
      pollGenRef.current += 1;
      if (sessionTimerRef.current !== null) {
        window.clearTimeout(sessionTimerRef.current);
      }
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
      sttRef.current?.stopListening();
      envAudioRef.current?.stop(0.2);
    },
    [],
  );

  async function start(): Promise<void> {
    // Fresh run: stop leftovers, reset guards.
    stt.stopListening();
    tts.stop();
    envAudioRef.current?.stop(0.2);
    clearSessionTimer();
    submittingRef.current = false;
    submittedTextRef.current = null;
    listenRetriesRef.current = 0;
    pollGenRef.current += 1;
    lastTurnCountRef.current = 0;
    setAiDegraded(null);
    setMood("mysterious");
    setBusy(true);
    setMicState("PROCESSING");
    try {
      const data = await postJson<{
        sessionId: string;
        status: string;
        adventure: { title: string };
        opening?: DmTurn;
      }>("/api/v1/sessions", { userId, durationMinutes: duration });
      setSession({
        sessionId: data.sessionId,
        status: data.status,
        adventure: data.adventure,
      });
      push(`Adventure started: ${data.adventure.title}`);
      // Session duration limit: auto-complete when time is up.
      sessionTimerRef.current = window.setTimeout(
        () => {
          void endSession(true);
        },
        duration * 60 * 1000,
      );
      if (data.opening?.narration) {
        // Direct path: opening is already here.
        adoptTurn(
          { turnNumber: 1, dmOutput: data.opening },
          { _id: data.sessionId, status: data.status },
          1,
        );
      } else {
        // Temporal path: the workflow generates the opening asynchronously.
        push("The mists gather… (waiting for the Dungeon Master)");
        const first = await pollSession(
          data.sessionId,
          (d) => d.turns.length > 0,
          240000,
        );
        if (!first || first.turns.length === 0) {
          push("The Dungeon Master is taking too long. Tap Start to retry.");
          setMicState("ERROR");
          return;
        }
        const rec = first.turns[first.turns.length - 1]!;
        adoptTurn(rec, first.session, first.turns.length);
      }
    } catch (err) {
      push(`Error: ${(err as Error).message}`);
      setMicState("ERROR");
    } finally {
      setBusy(false);
    }
  }

  async function sendTyped(): Promise<void> {
    const text = input.trim();
    if (!text || submittingRef.current) return;
    stt.stopListening();
    setInput("");
    await submitTranscript(text);
  }

  async function completeExercise(): Promise<void> {
    const current = sessionRef.current;
    if (!current || current.status !== "active") return;
    if (!current.currentExercise || current.currentExercise.completed) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    const exerciseId = current.currentExercise.exerciseId;
    try {
      const data = await postJson<{
        accepted: boolean;
        xpAwarded?: number;
      }>(`/api/v1/sessions/${current.sessionId}/exercise/complete`, {
        exerciseId,
      });
      if (data.xpAwarded !== undefined) {
        // Direct path: already applied.
        setSession((prev) =>
          prev && prev.currentExercise
            ? {
                ...prev,
                currentExercise: { ...prev.currentExercise, completed: true },
                isExerciseTurn: false,
              }
            : prev,
        );
        push(`Exercise complete (+${data.xpAwarded} XP)`);
        if (isSessionActive()) beginListening();
        return;
      }
      // Temporal path: the workflow validates + awards XP asynchronously.
      const done = await pollSession(
        current.sessionId,
        (d) =>
          (d.session.completedExercises ?? []).includes(exerciseId) ||
          d.session.currentExercise?.completed === true,
        120000,
      );
      if (!done) {
        push("Exercise confirmation is taking too long — it may still land.");
        return;
      }
      setSession((prev) =>
        prev
          ? {
              ...prev,
              player: done.session.player ?? prev.player,
              currentExercise: done.session.currentExercise ?? prev.currentExercise,
              isExerciseTurn: false,
            }
          : prev,
      );
      push("Exercise complete — well done, hero.");
      // After the workout, listen for what the hero does next.
      if (isSessionActive()) beginListening();
    } catch (err) {
      push(`Error: ${(err as Error).message}`);
    } finally {
      submittingRef.current = false;
    }
  }

  async function endSession(expired = false): Promise<void> {
    const current = sessionRef.current;
    clearSessionTimer();
    stt.stopListening();
    tts.stop();
    envAudioRef.current?.stop();
    submittingRef.current = false;
    if (!current) {
      setMicState("IDLE");
      return;
    }
    try {
      const data = await postJson<{
        accepted?: boolean;
        session?: { status?: string };
      }>(`/api/v1/sessions/${current.sessionId}/end`);
      if (data.session?.status === "completed") {
        setSession((prev) => (prev ? { ...prev, status: "completed" } : prev));
      } else {
        // Temporal path: the end signal is being processed — confirm briefly.
        await pollSession(
          current.sessionId,
          (d) => d.session.status === "completed",
          60000,
        );
        setSession((prev) => (prev ? { ...prev, status: "completed" } : prev));
      }
    } catch (err) {
      push(`End note: ${(err as Error).message}`);
      setSession((prev) => (prev ? { ...prev, status: "completed" } : prev));
    }
    setMicState("IDLE");
    push(expired ? "Time is up — the adventure is complete." : "Session completed.");
  }

  function toggleMic(): void {
    if (!isSessionActive()) return;
    if (micState === "LISTENING") {
      stt.stopListening();
      setMicState("IDLE");
      return;
    }
    if (micState === "DM_SPEAKING") {
      // Manual override: stop the DM voice, then listen.
      tts.stop();
      envAudioRef.current?.restore();
    }
    beginListening();
  }

  function toggleMute(): void {
    const next = !muted;
    setMuted(next);
    sfxRef.current?.setMuted(next);
    if (next) {
      envAudioRef.current?.stop(0.2);
    } else if (isSessionActive()) {
      envAudioRef.current?.start(lastEnvRef.current);
    }
  }

  function toggleStill(): void {
    const next = !stillOrb;
    setStillOrb(next);
    try {
      window.localStorage.setItem(STILL_KEY, next ? "1" : "0");
    } catch {
      // Persistence is a nicety.
    }
  }

  const completed = session?.status === "completed";
  const showTextFallback =
    !stt.supported || stt.error === "unsupported" || stt.error === "permission-denied";
  const orbState = orbStateFor(micState, completed || session === null);
  const orbLabel = `Dungeon Master orb: ${orbCaptionFor(micState, completed || session === null)}`;

  return (
    <div className="shell">
      {!session && (
        <>
          <div className="start-orb" aria-hidden="true">
            <OrbCanvas
              state="idle"
              mood="mysterious"
              trial={duration}
              energyRef={energyRef}
              still={stillOrb}
              variant="crystal"
              label="Dormant dungeon crystal orb"
            />
          </div>
          <div>
            <h1 className="start-title">DungeonsDaily</h1>
            <p className="start-lede">
              Your voice, your body, and a dungeon that listens. Move when the
              story demands it.
            </p>
          </div>
          <div className="start-form">
            <label className="field">
              <span>Hero name</span>
              <input
                className="text-input"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Length</span>
              <select
                className="select-input"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) as 10 | 20 | 30)}
              >
                <option value={10}>10 minutes</option>
                <option value={20}>20 minutes</option>
                <option value={30}>30 minutes</option>
              </select>
            </label>
            <button className="btn btn-primary" onClick={() => void start()} disabled={busy}>
              {busy ? "Gathering the mists…" : "Begin adventure"}
            </button>
          </div>
        </>
      )}

      {session && (
        <>
          <header className="session-head">
            <h1 className="session-title">{session.adventure.title}</h1>
            <p className="session-status">
              {session.status === "active"
                ? `${session.lastScene ? `${session.lastScene} · ` : ""}Turn ${session.turnCount ?? 0}`
                : "Adventure complete"}
            </p>
          </header>

          <div className="orb-stage">
            <div className="orb-frame">
              <OrbCanvas
                state={completed ? "idle" : orbState}
                mood={mood}
                trial={duration}
                energyRef={energyRef}
                still={stillOrb}
                variant="crystal"
                enlarged={true}
                label={orbLabel}
              />
            </div>
            <p className="orb-caption" aria-live="polite">
              {!completed && orbCaptionFor(micState, false)}
            </p>
          </div>

          {session.player && (
            <p className="stats-row" aria-label="Hero stats">
              <span>Level <strong>{session.player.level}</strong></span>
              <span><strong>{session.player.xp}</strong> XP</span>
              <span><strong>{session.player.health}</strong> HP</span>
            </p>
          )}

          {session.lastNarration && (
            <p className="narration">{session.lastNarration}</p>
          )}
          {session.lastPrompt && (
            <p className="turn-prompt">{session.lastPrompt}</p>
          )}

          {aiDegraded && !completed && (
            <p className="notice" role="status">⚠️ {aiDegraded}</p>
          )}

          {session.isExerciseTurn && session.currentExercise && !completed && (
            <div className="exercise-panel">
              <p className="exercise-name">
                {session.currentExercise.exerciseId.replace(/_/g, " ")}
              </p>
              <p className="exercise-detail">
                {session.currentExercise.reps
                  ? `${session.currentExercise.reps} repetitions`
                  : ""}
                {session.currentExercise.durationSeconds
                  ? `Hold ${session.currentExercise.durationSeconds} seconds`
                  : ""}
                {session.currentExercise.completed ? " · Done" : ""}
              </p>
              <button
                className="btn btn-primary"
                onClick={() => void completeExercise()}
                disabled={busy || submittingRef.current}
              >
                Complete exercise
              </button>
            </div>
          )}

          {!completed && (
            <>
              {(micState === "LISTENING" && (stt.interimTranscript || stt.transcript)) && (
                <p className="turn-prompt">
                  Hearing: {stt.interimTranscript || stt.transcript}
                </p>
              )}
              <div className="controls">
                <button
                  className="btn btn-primary"
                  onClick={toggleMic}
                  disabled={micState === "PROCESSING" || !stt.supported}
                  aria-label="Toggle microphone"
                >
                  {micState === "LISTENING" ? "Stop mic" : "Speak"}
                </button>
                <button className="btn btn-quiet" onClick={() => void endSession(false)}>
                  End session
                </button>
              </div>
              {voiceNotice && <p className="notice" role="status">{voiceNotice}</p>}
              {showTextFallback && (
                <p className="notice" role="status">
                  {stt.supported
                    ? "Microphone permission is required for voice input. Type your response instead."
                    : "Speech recognition is not supported in this browser. Type your response instead."}
                </p>
              )}
              <div className="type-row">
                <input
                  className="text-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void sendTyped();
                  }}
                  placeholder="Type your response"
                  aria-label="Type your response"
                />
                <button
                  className="btn btn-quiet"
                  onClick={() => void sendTyped()}
                  disabled={busy || !input.trim()}
                >
                  Send
                </button>
              </div>
              <div className="utility-row">
                <button className="chip" onClick={toggleMute} aria-pressed={muted}>
                  {muted ? "🔇 Unmute sounds" : "🔊 Mute sounds"}
                </button>
                <button className="chip" onClick={toggleStill} aria-pressed={stillOrb}>
                  {stillOrb ? "✦ Animate orb" : "✦ Still orb"}
                </button>
              </div>
            </>
          )}

          {completed && (
            <div>
              <h2 className="complete-title">Adventure complete</h2>
              {session.player && (
                <p className="stats-row">
                  <span>Level <strong>{session.player.level}</strong></span>
                  <span><strong>{session.player.xp}</strong> XP</span>
                  <span><strong>{session.player.health}</strong> HP</span>
                </p>
              )}
              <div className="controls" style={{ marginTop: "var(--space-4)" }}>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setSession(null);
                    setMicState("IDLE");
                    setVoiceNotice(null);
                    setAiDegraded(null);
                    submittedTextRef.current = null;
                  }}
                >
                  Start new adventure
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <details className="disclosure">
        <summary>Adventure log</summary>
        <pre className="log-view">{log.join("\n")}</pre>
      </details>
    </div>
  );
}
