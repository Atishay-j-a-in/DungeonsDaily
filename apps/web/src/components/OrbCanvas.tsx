import { useEffect, useRef } from "react";

// Immersive 3D WebGL Crystal Orb:
// Real-time raymarched 3D crystal sphere with polyhedral gemstone facets,
// Snell's Law optical refraction, internal volumetric 3D energy currents, pulsating
// living core, and voice-reactive shockwaves that surge with the DM's voice.
// Runs dependency-free with pure WebGL 1.0 shaders for 60fps across all devices.

export type OrbState =
  | "idle"
  | "thinking"
  | "speaking"
  | "listening"
  | "error"
  | "awakening";

export interface OrbCanvasProps {
  state: OrbState;
  /** Backend mood id (calm, mysterious, tense, combat, victorious, danger). */
  mood?: string;
  /** Time trial setting: 10 (Squire's emerald), 20 (Deep sapphire), 30 (Dragon ruby). */
  trial?: 10 | 20 | 30;
  /** 0..1 ambient/voice energy sampled from audio graph & speech (ref: no re-render). */
  energyRef?: React.MutableRefObject<number>;
  /** True = single static frame (reduced motion / stillness toggle). */
  still?: boolean;
  /** spirit = soft glow; crystal = faceted refractive stone. */
  variant?: "spirit" | "crystal";
  /** Is this orb enlarged into hero focus? */
  enlarged?: boolean;
  /** Is this orb in its summoning awakening ritual? */
  awakening?: boolean;
  label: string;
  className?: string;
}

const TRIAL_PALETTES: Record<
  number,
  { base: [number, number, number]; core: [number, number, number] }
> = {
  10: {
    // Squire's Trial: Deep emerald living crystal with golden radiant sun energy
    base: [0.03, 0.68, 0.35],
    core: [0.92, 0.76, 0.12],
  },
  20: {
    // Deep Delve: Abyssal arcane sapphire with electric celestial cyan currents
    base: [0.08, 0.42, 0.95],
    core: [0.05, 0.82, 0.96],
  },
  30: {
    // Dragon's Vigil: Dragon heart crimson ruby with molten amber solar flares
    base: [0.88, 0.14, 0.10],
    core: [0.98, 0.62, 0.08],
  },
};

const MOOD_PALETTES: Record<
  string,
  { base: [number, number, number]; core: [number, number, number] }
> = {
  calm: { base: [0.05, 0.62, 0.38], core: [0.85, 0.82, 0.25] },
  mysterious: { base: [0.10, 0.42, 0.88], core: [0.35, 0.78, 0.98] },
  tense: { base: [0.75, 0.48, 0.12], core: [0.95, 0.75, 0.25] },
  combat: { base: [0.85, 0.28, 0.10], core: [0.98, 0.58, 0.15] },
  victorious: { base: [0.88, 0.68, 0.18], core: [0.98, 0.88, 0.35] },
  danger: { base: [0.82, 0.12, 0.10], core: [0.95, 0.52, 0.12] },
};

const DEFAULT_PALETTE = {
  base: [0.10, 0.52, 0.72] as [number, number, number],
  core: [0.88, 0.72, 0.25] as [number, number, number],
};

const VERT = `attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_res;
uniform float u_time;
uniform float u_speak;
uniform float u_energy;
uniform float u_listen;
uniform float u_think;
uniform float u_error;
uniform float u_awake;
uniform float u_crystal;
uniform vec3 u_base_col;
uniform vec3 u_core_col;
uniform vec3 u_mood;
uniform vec2 u_mouse;

// Deterministic 3D Hash & Value Noise
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 x) {
  vec3 p = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash3(p + vec3(0.0, 0.0, 0.0)), hash3(p + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash3(p + vec3(0.0, 1.0, 0.0)), hash3(p + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(hash3(p + vec3(0.0, 0.0, 1.0)), hash3(p + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash3(p + vec3(0.0, 1.0, 1.0)), hash3(p + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise3(p);
    p = p * 2.02 + vec3(1.3, 2.7, 4.1);
    a *= 0.5;
  }
  return v;
}

// 2D noise for atmosphere sparkles
float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
    mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Polyhedral Gemstone Facet Normal
vec3 getFacetNormal(vec3 n, float cr, out float seamDist) {
  if (cr < 0.02) {
    seamDist = 1.0;
    return n;
  }
  float bestDot = -2.0;
  vec3 bestAxis = n;
  const float phi = 1.61803398875;

  vec3 a1 = normalize(vec3(1.0, phi, 0.0));
  vec3 a2 = normalize(vec3(-1.0, phi, 0.0));
  vec3 a3 = normalize(vec3(0.0, 1.0, phi));
  vec3 a4 = normalize(vec3(0.0, -1.0, phi));
  vec3 a5 = normalize(vec3(phi, 0.0, 1.0));
  vec3 a6 = normalize(vec3(-phi, 0.0, 1.0));

  #define TEST_AXIS(ax) { float dt = dot(n, ax); if(abs(dt) > bestDot) { bestDot = abs(dt); bestAxis = sign(dt) * ax; } }
  TEST_AXIS(a1); TEST_AXIS(a2); TEST_AXIS(a3);
  TEST_AXIS(a4); TEST_AXIS(a5); TEST_AXIS(a6);
  TEST_AXIS(vec3(1.0, 0.0, 0.0));
  TEST_AXIS(vec3(0.0, 1.0, 0.0));
  TEST_AXIS(vec3(0.0, 0.0, 1.0));
  TEST_AXIS(normalize(vec3(1.0, 1.0, 1.0)));
  TEST_AXIS(normalize(vec3(-1.0, 1.0, 1.0)));
  TEST_AXIS(normalize(vec3(1.0, -1.0, 1.0)));
  TEST_AXIS(normalize(vec3(-1.0, -1.0, 1.0)));

  seamDist = length(bestAxis - n);
  return normalize(mix(n, bestAxis, cr * 0.72));
}

// ACES Film Tone Mapping curve: guarantees zero white clipping while preserving rich saturation
vec3 toneMapACES(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);

  // 3D Perspective Ray
  vec3 ro = vec3(0.0, 0.0, 2.2);
  vec3 rd = normalize(vec3(uv - u_mouse * 0.12, -1.65));

  // Ray-Sphere Intersection
  float R = 0.68;
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float h = b * b - c;

  // Outer Atmosphere Aura & Particle Sparkles
  float r2d = length(uv);
  float auraDist = max(0.0, r2d - R * 0.88);
  float aura = exp(-auraDist * 5.2) * (0.28 + u_speak * 0.45 + u_energy * 0.4 + u_awake * 0.45 + u_think * 0.25);
  float spk = pow(noise2(uv * 18.0 + vec2(u_time * 0.35, -u_time * 0.25)), 9.0) * exp(-r2d * 2.8);
  vec3 auraCol = u_base_col * aura * 0.85 + u_core_col * spk * 0.9;

  if (h < 0.0) {
    // Ray misses the crystal body: render soft ethereal outer mist
    float vig = smoothstep(0.95, 0.25, r2d);
    vec3 outAura = toneMapACES(auraCol * mix(0.4, 1.0, vig));
    gl_FragColor = vec4(outAura, 1.0);
    return;
  }

  float t_in = -b - sqrt(h);
  float t_out = -b + sqrt(h);

  vec3 p_in = ro + rd * t_in;
  vec3 norm = normalize(p_in);

  float seamDist = 1.0;
  vec3 fn = getFacetNormal(norm, u_crystal, seamDist);
  float seam = smoothstep(0.20, 0.03, seamDist) * u_crystal;

  // Snell's Law Refraction into crystal interior
  vec3 r_dir = refract(rd, fn, 0.74);
  if (dot(r_dir, r_dir) < 0.05) {
    r_dir = reflect(rd, fn);
  }

  // Deep translucent gemstone body: keeps crystal dark and mysterious so light pops!
  vec3 gemDark = u_base_col * 0.06 + vec3(0.005, 0.008, 0.008);

  // Volumetric Living Energy Rays
  vec3 accumEnergy = vec3(0.0);
  float stepSize = (t_out - t_in) / 16.0;
  vec3 curPos = p_in + r_dir * stepSize * 0.5;

  float swirlSpeed = 0.75 + u_speak * 1.8 + u_energy * 1.5 + u_awake * 1.8 + u_think * 0.8;
  float heartSpeed = 2.0 + u_speak * 2.5 + u_energy * 2.2 + u_awake * 2.2;
  float heartPulse = sin(u_time * heartSpeed) * 0.5 + 0.5;

  for (int i = 0; i < 16; i++) {
    float r = length(curPos);
    if (r < R) {
      // 3D Vortex Swirl around Y-axis
      float twist = (1.0 - r / R) * 2.6 + u_time * swirlSpeed;
      float s = sin(twist);
      float cs = cos(twist);
      vec3 twisted = vec3(curPos.x * cs - curPos.z * s, curPos.y, curPos.x * s + curPos.z * cs);

      // Living 3D Mana Turbulence
      float n = fbm3(twisted * 4.2 - vec3(0.0, u_time * (swirlSpeed * 0.55), 0.0));

      // Living Pulsating Heart Core
      float coreDensity = exp(-r * (4.8 - heartPulse * 1.2 - u_speak * 1.2 - u_energy * 1.0));

      // Voice Reactive Shockwaves (sound ripples through crystal)
      float shockwave = sin(r * 20.0 - u_time * (10.0 + u_speak * 7.0)) * 0.5 + 0.5;
      shockwave *= (u_speak * 0.75 + u_energy * 0.65 + u_awake * 0.6) * (1.0 - r / R);

      // Vivid Mana Ribbon Veins
      float vein = pow(max(0.0, 1.0 - abs(n - 0.48)), 6.0);

      // Saturated Color Synthesis
      vec3 sliceCol = mix(u_base_col, u_core_col, clamp(coreDensity * 0.85 + shockwave * 0.5, 0.0, 1.0));
      vec3 veinCol = mix(u_core_col, u_base_col, 0.35);

      float dens = coreDensity * 0.75 + vein * 1.1 + shockwave * 0.55;
      accumEnergy += (sliceCol * (coreDensity * 0.75 + shockwave * 0.55) + veinCol * (vein * 1.1)) * stepSize * (1.2 + u_speak * 0.9 + u_energy * 0.8 + u_awake * 0.8);
    }
    curPos += r_dir * stepSize;
  }

  // 3D Lighting & Crystal Facets
  vec3 light1 = normalize(vec3(0.5, 0.85, 0.8));
  vec3 light2 = normalize(vec3(-0.7, -0.4, 0.7));
  vec3 refVec = reflect(rd, fn);
  float spec1 = pow(max(0.0, dot(refVec, light1)), 28.0);
  float spec2 = pow(max(0.0, dot(refVec, light2)), 14.0);

  // Fresnel Rim Reflection
  float fresnel = pow(1.0 - max(0.0, dot(-rd, fn)), 3.0);

  // Final Crystal Composition
  vec3 crystalCol = gemDark + accumEnergy;
  crystalCol += u_base_col * fresnel * 0.65;
  crystalCol += mix(u_base_col, u_core_col, 0.6) * (spec1 * 0.75 + spec2 * 0.25);
  crystalCol += mix(u_core_col, u_base_col, 0.4) * seam * 0.65;

  // Reactivity with Mood / Listening / Error
  crystalCol = mix(crystalCol, u_mood, clamp(fresnel * 0.35, 0.0, 1.0));
  crystalCol = mix(crystalCol, vec3(0.1, 0.65, 0.75), u_listen * 0.3);
  crystalCol = mix(crystalCol, vec3(0.75, 0.15, 0.12), u_error * 0.45);

  // Blend Crystal Surface with Atmosphere
  float bodyEdge = smoothstep(R + 0.02, R - 0.03, r2d);
  vec3 finalCol = mix(auraCol, crystalCol + auraCol * 0.25, bodyEdge);

  // Soft Vignette
  float vig = smoothstep(0.95, 0.25, r2d);
  finalCol *= mix(0.45, 1.0, vig);

  // Tone Map & Gamma correct to guarantee vivid, saturated, magical colors (NO FLAT WHITE!)
  vec3 graded = toneMapACES(finalCol * 1.35);
  graded = pow(graded, vec3(0.92)); // Rich contrast boost

  gl_FragColor = vec4(graded, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  gl.shaderSource(vs, VERT);
  gl.shaderSource(fs, FRAG);
  gl.compileShader(vs);
  gl.compileShader(fs);

  if (
    !gl.getShaderParameter(vs, gl.COMPILE_STATUS) ||
    !gl.getShaderParameter(fs, gl.COMPILE_STATUS)
  ) {
    const fsLog = gl.getShaderInfoLog(fs);
    if (fsLog) console.warn("[orb] Fragment shader compile log:", fsLog);
    return null;
  }

  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[orb] Program link error:", gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

export function OrbCanvas({
  state,
  mood = "mysterious",
  trial,
  energyRef,
  still = false,
  variant = "crystal",
  enlarged = false,
  awakening = false,
  label,
  className = "orb-canvas",
}: OrbCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef<[number, number]>([0, 0]);

  // Compute active palette
  const activePalette = trial
    ? TRIAL_PALETTES[trial] ?? DEFAULT_PALETTE
    : MOOD_PALETTES[mood] ?? DEFAULT_PALETTE;

  const stateRef = useRef({
    state,
    mood,
    variant,
    enlarged,
    awakening,
    baseCol: activePalette.base,
    coreCol: activePalette.core,
  });
  stateRef.current = {
    state,
    mood,
    variant,
    enlarged,
    awakening,
    baseCol: activePalette.base,
    coreCol: activePalette.core,
  };

  const stillRef = useRef(still);
  stillRef.current = still;
  const kickRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const fail = (reason: string): void => {
      canvas.dataset.nogl = "true";
      console.warn(`[orb] WebGL fallback active (${reason}).`);
    };

    let gl: WebGLRenderingContext | null = null;
    try {
      if (typeof window.WebGLRenderingContext === "undefined") {
        fail("no WebGL support");
        return;
      }
      gl = canvas.getContext("webgl", {
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      }) as WebGLRenderingContext | null;
      if (!gl || gl.isContextLost()) {
        fail("context lost or unavailable");
        return;
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
      return;
    }

    const prog = compileShader(gl);
    if (!prog) {
      fail("shader compile failed");
      return;
    }

    const onLost = (e: Event): void => {
      e.preventDefault();
      fail("context lost");
    };
    canvas.addEventListener("webglcontextlost", onLost);

    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const loc = (name: string): WebGLUniformLocation | null =>
      gl.getUniformLocation(prog, name);
    const uRes = loc("u_res");
    const uTime = loc("u_time");
    const uSpeak = loc("u_speak");
    const uEnergy = loc("u_energy");
    const uListen = loc("u_listen");
    const uThink = loc("u_think");
    const uError = loc("u_error");
    const uAwake = loc("u_awake");
    const uCrystal = loc("u_crystal");
    const uBaseCol = loc("u_base_col");
    const uCoreCol = loc("u_core_col");
    const uMood = loc("u_mood");
    const uMouse = loc("u_mouse");

    let raf = 0;
    let running = true;
    let last = performance.now();
    const smooth = {
      speak: 0,
      energy: 0,
      listen: 0,
      think: 0,
      error: 0,
      awake: 0,
      mouseX: 0,
      mouseY: 0,
    };
    let t = Math.random() * 100;

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
      const w = Math.max(2, Math.floor(rect.width * dpr));
      const h = Math.max(2, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resize)
        : null;
    ro?.observe(canvas);

    const handlePointerMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        const ny = -(((e.clientY - rect.top) / rect.height - 0.5) * 2);
        mouseRef.current = [nx, ny];
      }
    };
    canvas.addEventListener("pointermove", handlePointerMove);

    const draw = (now: number): void => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!stillRef.current) t += dt;

      const {
        state: st,
        variant: vr,
        awakening: isAwake,
        baseCol,
        coreCol,
      } = stateRef.current;

      const currentEnergy = energyRef ? energyRef.current : 0;
      const target = {
        speak: st === "speaking" ? 1 : 0,
        energy:
          st === "speaking" || st === "thinking" || isAwake
            ? Math.max(0.2, currentEnergy)
            : currentEnergy,
        listen: st === "listening" ? 1 : 0,
        think: st === "thinking" ? 1 : 0,
        error: st === "error" ? 1 : 0,
        awake: isAwake || st === "awakening" ? 1 : 0,
        mouseX: mouseRef.current[0],
        mouseY: mouseRef.current[1],
      };

      const k = stillRef.current ? 1 : 1 - Math.exp(-dt * 6);
      smooth.speak += (target.speak - smooth.speak) * k;
      smooth.energy += (target.energy - smooth.energy) * k;
      smooth.listen += (target.listen - smooth.listen) * k;
      smooth.think += (target.think - smooth.think) * k;
      smooth.error += (target.error - smooth.error) * k;
      smooth.awake += (target.awake - smooth.awake) * k;
      smooth.mouseX += (target.mouseX - smooth.mouseX) * k;
      smooth.mouseY += (target.mouseY - smooth.mouseY) * k;

      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uSpeak, smooth.speak);
      gl.uniform1f(uEnergy, Math.min(1, Math.max(0, smooth.energy)));
      gl.uniform1f(uListen, smooth.listen);
      gl.uniform1f(uThink, smooth.think);
      gl.uniform1f(uError, smooth.error);
      gl.uniform1f(uAwake, smooth.awake);
      gl.uniform1f(uCrystal, vr === "crystal" ? 1 : 0);
      gl.uniform3f(uBaseCol, baseCol[0], baseCol[1], baseCol[2]);
      gl.uniform3f(uCoreCol, coreCol[0], coreCol[1], coreCol[2]);
      gl.uniform3f(uMood, baseCol[0], baseCol[1], baseCol[2]);
      gl.uniform2f(uMouse, smooth.mouseX, smooth.mouseY);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!stillRef.current) raf = requestAnimationFrame(draw);
    };

    const onVis = (): void => {
      if (!document.hidden && !stillRef.current) {
        cancelAnimationFrame(raf);
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    kickRef.current = () => {
      if (stillRef.current || document.hidden) return;
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(draw);
    };

    last = performance.now();
    if (stillRef.current) {
      draw(last);
    } else {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("pointermove", handlePointerMove);
      ro?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!still) kickRef.current?.();
  }, [still]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={className}
    />
  );
}
