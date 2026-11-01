// Day 8 theme player: per-build song cache with live-synth fallback.
//
// The first play of a build renders its entrance arrangement once through an
// OfflineAudioContext and caches the buffer by build signature, so replays
// start instantly and cost no CPU. Anything failing along that path (no
// OfflineAudioContext, render error, blocked output) falls back to the
// original live WebAudio synth, and when even that is blocked the caller
// still gets `started: false` to show its visual fallback. The synth needs
// no network, so cached or live playback both work offline. Swapping the
// sound source later (Mureka themes generated ahead of time) only changes
// where the cached buffer comes from.

export interface ThemeHandle {
  stop: () => void;
  /** Resolves when playback actually starts (false if audio is blocked). */
  started: Promise<boolean>;
}

const STEP_SECONDS = 0.42;

const bufferCache = new Map<string, AudioBuffer>();

function scheduleTheme(
  ctx: BaseAudioContext,
  dest: AudioNode,
  notes: number[],
  t0: number,
): OscillatorNode[] {
  const voices: OscillatorNode[] = [];
  notes.forEach((freq, i) => {
    const at = t0 + i * STEP_SECONDS;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, at + STEP_SECONDS * 0.95);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(at);
    osc.stop(at + STEP_SECONDS);
    voices.push(osc);
    // Soft root note under every fourth step keeps it musical.
    if (i % 4 === 0) {
      const bass = ctx.createOscillator();
      bass.type = "sine";
      bass.frequency.value = 130.81; // C3
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0, at);
      bg.gain.linearRampToValueAtTime(0.5, at + 0.05);
      bg.gain.exponentialRampToValueAtTime(0.001, at + STEP_SECONDS * 3.5);
      bass.connect(bg);
      bg.connect(dest);
      bass.start(at);
      bass.stop(at + STEP_SECONDS * 3.6);
      voices.push(bass);
    }
  });
  return voices;
}

/** Render the arrangement to a buffer once per signature; null when impossible. */
async function renderCached(
  OfflineCtor:
    | (new (channels: number, length: number, sampleRate: number) => OfflineAudioContext)
    | undefined,
  key: string,
  notes: number[],
): Promise<AudioBuffer | null> {
  const hit = bufferCache.get(key);
  if (hit) return hit;
  if (!OfflineCtor) return null;
  try {
    const seconds = notes.length * STEP_SECONDS + 1.6;
    const offline = new OfflineCtor(1, Math.ceil(seconds * 22050), 22050);
    const master = offline.createGain();
    master.gain.value = 0.16;
    master.connect(offline.destination);
    scheduleTheme(offline, master, notes, 0.05);
    const buffer = await offline.startRendering();
    bufferCache.set(key, buffer);
    return buffer;
  } catch {
    return null;
  }
}

/** Test hook: how many builds have a cached render. */
export function cachedThemeCount(): number {
  return bufferCache.size;
}

export function playTheme(notes: number[], signature?: string): ThemeHandle {
  const key = signature ?? notes.join(",");
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return { stop: () => {}, started: Promise.resolve(false) };

  let stopped = false;
  const live: OscillatorNode[] = [];
  let source: AudioBufferSourceNode | null = null;
  let ctx: AudioContext | null = null;
  const stopAll = () => {
    stopped = true;
    for (const o of live) {
      try { o.stop(); } catch { /* already stopped */ }
    }
    try { source?.stop(); } catch { /* already stopped */ }
    try { void ctx?.close().catch(() => {}); } catch { /* already closed */ }
  };

  const started = (async (): Promise<boolean> => {
    try {
      ctx = new Ctor();
      const OfflineCtor = (window as { OfflineAudioContext?: new (channels: number, length: number, sampleRate: number) => OfflineAudioContext }).OfflineAudioContext;
      const cached = await renderCached(OfflineCtor, key, notes).catch(() => null);
      if (stopped) return false;
      const master = ctx.createGain();
      master.gain.value = 0.16;
      master.connect(ctx.destination);
      await ctx.resume().catch(() => {});
      if (stopped || ctx.state !== "running") return false;
      if (cached) {
        // Cache hit (or fresh render): sample-accurate replay of the same mix.
        source = ctx.createBufferSource();
        source.buffer = cached;
        source.connect(master);
        source.start(ctx.currentTime + 0.05);
      } else {
        // Render unavailable: fall back to the live synth voice-for-voice.
        live.push(...scheduleTheme(ctx, master, notes, ctx.currentTime + 0.05));
      }
      return true;
    } catch {
      return false;
    }
  })();

  return { stop: stopAll, started };
}
