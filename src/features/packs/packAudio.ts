// WebAudio sound effects for the Daily Pack rip sequence, ported from
// drafts/ToyVentor-PackRip-ToyWorld.html with explicit lifecycle cleanup.

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export interface PackAudio {
  unlock: () => void;
  setEnabled: (on: boolean) => void;
  riser: (timeScale?: number) => void;
  tear: () => void;
  whoosh: () => void;
  pop: (index: number) => void;
  tick: (progress: number) => void;
  flip: () => void;
  chime: (slot: number) => void;
  fan: () => void;
  dispose: () => void;
}

export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    // Vibration can be blocked before a user gesture or unsupported; ignore.
  }
}

export function createPackAudio(initialEnabled = true): PackAudio {
  let ac: AudioContext | null = null;
  let enabled = initialEnabled;
  let disposed = false;

  const ensureCtx = (): AudioContext | null => {
    if (disposed || typeof window === "undefined") return null;
    if (!ac) {
      const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!Ctor) return null;
      try {
        ac = new Ctor();
      } catch {
        return null;
      }
    }
    if (ac.state === "suspended") {
      void ac.resume().catch(() => {});
    }
    return ac;
  };

  const tone = (
    freq: number,
    offsetSec: number,
    durSec: number,
    type: OscillatorType = "sine",
    vol = 0.12,
    endFreq?: number,
  ) => {
    if (!enabled) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + offsetSec;
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      if (endFreq) {
        osc.frequency.exponentialRampToValueAtTime(endFreq, start + durSec);
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(vol, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + durSec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + durSec + 0.05);
    } catch {
      // Ignore WebAudio scheduling errors if context is closing.
    }
  };

  const noise = (
    offsetSec: number,
    durSec: number,
    freqStart: number,
    freqEnd: number,
    vol = 0.2,
  ) => {
    if (!enabled) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    try {
      const length = Math.max(1, Math.floor(ctx.sampleRate * durSec));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      const start = ctx.currentTime + offsetSec;
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(freqStart, start);
      filter.frequency.exponentialRampToValueAtTime(freqEnd, start + durSec);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + durSec);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(start);
    } catch {
      // Ignore WebAudio scheduling errors.
    }
  };

  return {
    unlock() {
      ensureCtx();
    },
    setEnabled(on: boolean) {
      enabled = on;
    },
    riser(timeScale = 1) {
      tone(180, 0, 1.0 * timeScale, "sawtooth", 0.05, 720);
    },
    tear() {
      noise(0, 0.25, 2500, 500, 0.3);
      tone(120, 0, 0.2, "square", 0.08, 60);
    },
    whoosh() {
      noise(0, 0.5, 300, 3000, 0.18);
    },
    pop(index: number) {
      tone(420 + index * 90, 0, 0.12, "sine", 0.14, 260);
    },
    tick(progress: number) {
      tone(240 + progress * 520, 0, 0.07, "square", 0.06);
    },
    flip() {
      noise(0, 0.08, 1800, 900, 0.12);
    },
    chime(slot: number) {
      const base = [523, 659, 880][Math.min(2, Math.max(0, slot))] ?? 659;
      tone(base, 0, 0.6, "triangle", 0.14);
      tone(base * 1.5, 0.05, 0.6, "sine", 0.08);
    },
    fan() {
      [523, 659, 784, 1047].forEach((f, i) => {
        tone(f, i * 0.09, 0.5, "triangle", 0.14);
      });
    },
    dispose() {
      disposed = true;
      if (ac) {
        void ac.close().catch(() => {});
        ac = null;
      }
    },
  };
}
