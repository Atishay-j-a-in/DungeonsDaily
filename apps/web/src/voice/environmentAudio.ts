// Environment audio — deliberately separate from the DM voice
// (speechSynthesis). Plays the static sound library from /public as a
// looped ambient bed per scene environment, ducked while the DM speaks.
// Falls back to generative filtered noise if an asset fails to load.

const ENVIRONMENT_TRACKS: Record<string, string[]> = {
  forest: ["/forest.mp3", "/birds.mp3"],
  cave: ["/cave-ambience.mp3"],
  dungeon: ["/cave-ambience.mp3"],
  castle: ["/rain.mp3"],
  village: ["/birds.mp3"],
  battlefield: ["/battle.mp3"],
  mountain: ["/thunder.mp3"],
  ruins: ["/waterfall.mp3"],
};

const FULL_VOLUME = 0.35;
const DUCKED_VOLUME = 0.08;

export class EnvironmentAudio {
  private layers: HTMLAudioElement[] = [];
  private noiseFallback: {
    context: AudioContext;
    gain: GainNode;
    source: AudioBufferSourceNode;
  } | null = null;
  private currentEnvironment = "";
  // Optional WebAudio graph (master gain + analyser) feeding the orb's
  // energy meter. Attached only when the context actually runs — a suspended
  // context would silence the beds, so direct playback stays the default.
  private graph: {
    context: AudioContext;
    master: GainNode;
    analyser: AnalyserNode;
    samples: Uint8Array<ArrayBuffer>;
  } | null = null;
  private energy = 0;

  get activeEnvironment(): string {
    return this.currentEnvironment;
  }

  /** 0..1 smoothed ambient loudness for the orb. 0 when unattached. */
  getEnergy(): number {
    const g = this.graph;
    if (!g) return 0;
    try {
      g.analyser.getByteTimeDomainData(g.samples);
      let sum = 0;
      for (let i = 0; i < g.samples.length; i += 1) {
        const v = (g.samples[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / g.samples.length);
      const target = Math.min(1, rms * 3.2);
      this.energy += (target - this.energy) * 0.25;
      return this.energy;
    } catch {
      return 0;
    }
  }

  /** Start (or retune) the ambient loop for a scene environment. */
  start(environment: string): void {
    try {
      if (environment === this.currentEnvironment && this.layers.length > 0) {
        void this.playAll();
        return;
      }
      this.currentEnvironment = environment;
      this.stopLayers();
      this.stopNoise();
      if (this.graph) {
        try {
          this.graph.master.gain.setTargetAtTime(
            FULL_VOLUME,
            this.graph.context.currentTime,
            0.2,
          );
        } catch {
          // Ignore.
        }
      }
      const tracks =
        ENVIRONMENT_TRACKS[environment] ??
        ENVIRONMENT_TRACKS.dungeon ??
        [];
      let started = false;
      const graphed = this.ensureGraph();
      for (const src of tracks) {
        const audio = new Audio(src);
        audio.loop = true;
        // Graph mode drives volume from the master gain (element volume is
        // captured inconsistently across browsers), so pin it to full.
        audio.volume = graphed ? 1 : FULL_VOLUME;
        if (graphed) this.attachLayer(audio);
        audio.addEventListener("error", () => {
          // Single static asset failed — fall back to generative noise.
          if (!started) {
            started = true;
            this.startNoiseFallback();
          }
        });
        audio.addEventListener("canplay", () => {
          started = true;
        });
        this.layers.push(audio);
      }
      void this.playAll();
      // If every asset 404s (silent failure), the error handlers above
      // switch to the generative fallback.
    } catch {
      // Ambient audio is decorative — never break the game.
    }
  }

  /** Lower ambience while the DM voice speaks so narration stays clear. */
  duck(): void {
    if (this.graph) {
      try {
        this.graph.master.gain.setTargetAtTime(
          DUCKED_VOLUME,
          this.graph.context.currentTime,
          0.2,
        );
      } catch {
        // Ignore.
      }
    } else {
      for (const layer of this.layers) layer.volume = DUCKED_VOLUME;
    }
    try {
      this.noiseFallback?.gain.gain.setTargetAtTime(
        0.012,
        this.noiseFallback.context.currentTime,
        0.2,
      );
    } catch {
      // Ignore.
    }
  }

  /** Restore ambience after TTS ends. */
  restore(): void {
    if (this.graph) {
      try {
        this.graph.master.gain.setTargetAtTime(
          FULL_VOLUME,
          this.graph.context.currentTime,
          0.4,
        );
      } catch {
        // Ignore.
      }
    } else {
      for (const layer of this.layers) layer.volume = FULL_VOLUME;
    }
    try {
      this.noiseFallback?.gain.gain.setTargetAtTime(
        0.05,
        this.noiseFallback.context.currentTime,
        0.4,
      );
    } catch {
      // Ignore.
    }
  }

  /** Stop (with a quick fade) all environment audio, e.g. on session end. */
  stop(fadeSeconds = 0.6): void {
    this.currentEnvironment = "";
    const layers = this.layers;
    this.layers = [];
    if (this.graph) {
      try {
        this.graph.master.gain.setTargetAtTime(
          0,
          this.graph.context.currentTime,
          Math.max(0.05, fadeSeconds / 3),
        );
      } catch {
        // Fall through to immediate stop.
      }
    }
    const stepMs = 50;
    const steps = Math.max(1, Math.floor((fadeSeconds * 1000) / stepMs));
    let step = 0;
    const fade = window.setInterval(() => {
      step += 1;
      const factor = Math.max(0, 1 - step / steps);
      for (const layer of layers) layer.volume = FULL_VOLUME * factor;
      if (step >= steps) {
        window.clearInterval(fade);
        for (const layer of layers) {
          layer.pause();
          layer.removeAttribute("src");
          layer.load();
        }
      }
    }, stepMs);
    this.stopNoise();
  }

  private async playAll(): Promise<void> {
    // A user gesture (Start / Speak tap) may have unlocked audio since the
    // last attempt — retry the graph so the orb gets its energy feed.
    if (!this.graph) {
      if (this.ensureGraph()) {
        for (const layer of this.layers) {
          try {
            layer.volume = 1;
            this.attachLayer(layer);
          } catch {
            // Keep direct playback.
          }
        }
      }
    } else {
      try {
        await this.graph.context.resume();
      } catch {
        // Keep playing directly.
      }
    }
    for (const layer of this.layers) {
      try {
        await layer.play();
      } catch {
        // Autoplay blocked until the user interacts — the Start/session
        // click counts as interaction, so retry once on next start().
      }
    }
  }

  /** Build the master gain + analyser once the context runs. */
  private ensureGraph(): boolean {
    if (this.graph) return true;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return false;
      const context = new Ctor();
      // resume() resolves asynchronously: a suspended context means "no
      // gesture yet" — stay on direct playback and retry on the next
      // start()/playAll() once a tap has unlocked audio.
      if (context.state === "suspended") {
        void context.resume().catch(() => undefined);
        void context.close().catch(() => undefined);
        return false;
      }
      const master = context.createGain();
      master.gain.value = FULL_VOLUME;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      master.connect(analyser);
      analyser.connect(context.destination);
      this.graph = {
        context,
        master,
        analyser,
        samples: new Uint8Array(analyser.fftSize),
      };
      return true;
    } catch {
      return false;
    }
  }

  private attachLayer(audio: HTMLAudioElement): void {
    const g = this.graph;
    if (!g) return;
    try {
      const source = g.context.createMediaElementSource(audio);
      source.connect(g.master);
    } catch {
      // Already attached or unsupported — direct playback continues.
    }
  }

  private stopLayers(): void {
    for (const layer of this.layers) {
      try {
        layer.pause();
        layer.removeAttribute("src");
        layer.load();
      } catch {
        // Ignore.
      }
    }
    this.layers = [];
  }

  private startNoiseFallback(): void {
    try {
      if (this.noiseFallback) return;
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      const context = new Ctor();
      const gain = context.createGain();
      gain.gain.value = 0.05;
      gain.connect(context.destination);
      const length = context.sampleRate * 2;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 300;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(filter);
      filter.connect(gain);
      source.start();
      this.noiseFallback = { context, gain, source };
    } catch {
      // Ignore.
    }
  }

  private stopNoise(): void {
    const fallback = this.noiseFallback;
    this.noiseFallback = null;
    if (!fallback) return;
    try {
      fallback.source.stop();
      void fallback.context.close();
    } catch {
      // Ignore.
    }
  }
}
