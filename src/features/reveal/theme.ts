// Placeholder theme player: WebAudio synth, until a Mureka key lands and
// real themes are generated ahead of time (spec: Reveal). The melody
// itself comes from shared/reveal.ts, so swapping the sound source later
// doesn't change which build gets which theme.

export interface ThemeHandle {
  stop: () => void;
  /** Resolves when playback actually starts (false if audio is blocked). */
  started: Promise<boolean>;
}

const STEP_SECONDS = 0.42;

export function playTheme(notes: number[]): ThemeHandle {
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return { stop: () => {}, started: Promise.resolve(false) };

  const ctx = new Ctor();
  const master = ctx.createGain();
  master.gain.value = 0.16;
  master.connect(ctx.destination);
  const oscillators: OscillatorNode[] = [];

  const started = ctx.resume().then(() => {
    if (ctx.state !== "running") return false;
    const t0 = ctx.currentTime + 0.05;
    notes.forEach((freq, i) => {
      const at = t0 + i * STEP_SECONDS;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(1, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, at + STEP_SECONDS * 0.95);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + STEP_SECONDS);
      oscillators.push(osc);
      // Soft root note under every fourth step keeps it musical.
      if (i % 4 === 0) {
        const bass = ctx.createOscillator();
        bass.type = "sine";
        bass.frequency.value = 130.81; // C3
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0, at);
        bg.gain.linearRampToValueAtTime(0.5, at + 0.05);
        bg.gain.exponentialRampToValueAtTime(0.001, at + STEP_SECONDS * 3.5);
        bass.connect(bg).connect(master);
        bass.start(at);
        bass.stop(at + STEP_SECONDS * 3.6);
        oscillators.push(bass);
      }
    });
    return true;
  }).catch(() => false);

  return {
    started,
    stop: () => {
      for (const o of oscillators) {
        try { o.stop(); } catch { /* already stopped */ }
      }
      void ctx.close().catch(() => {});
    },
  };
}
