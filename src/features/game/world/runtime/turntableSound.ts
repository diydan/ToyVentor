// The title turntable's sounds (turntableSpin.ts has the numbers): a soft click when a finger grabs it, a whoosh that rises and brightens with its speed and leans the way it turns (nothing
// at idle), a quiet tick for each rim light that passes while it is being played with, and a low settle when a fling has died down. All procedural WebAudio, no files.
//
// Respects the game's one mute (runtime/audio.ts `sound`, the same switch every other sound uses) and prefers-reduced-motion (no whoosh, no ticks). Sound starts only from the grab: the
// caller runs `noteGesture()` first, and `ctx()` returns null until a tap has happened, so there is nothing to start before then.
import { ctx, noise, sound, tone } from "./audio";
import { IDLE_SPEED, tickAudible, whooshFor, type SpinStep } from "./turntableSpin";

interface Bed {
  a: AudioContext;
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
}

export interface TurntableSound {
  grab(): void;
  release(): void;
  /** Every frame the table is on show. */
  update(step: SpinStep): void;
  /** The table is off show (the world is playing): the whoosh goes quiet at once. */
  quiet(): void;
}

export function createTurntableSound(opts: { reduceMotion?: boolean; idle?: number } = {}): TurntableSound {
  const reduce = !!opts.reduceMotion;
  const idle = opts.idle ?? IDLE_SPEED;
  let bed: Bed | null = null;
  let lastGain = 0;

  /** The whoosh's noise, built on the first need and rebuilt if the world's audio context was replaced (audio.ts `resetAudio`). */
  function ensure(): Bed | null {
    const a = ctx();
    if (!a) return null;
    if (bed && bed.a === a) return bed;
    try {
      const n = Math.floor(a.sampleRate * 2);
      const buf = a.createBuffer(1, n, a.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        last = last * 0.55 + w * 0.45;   // a little warmer than white noise
        d[i] = last * 1.6;
      }
      const src = a.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = a.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 300;
      filter.Q.value = 0.9;
      const gain = a.createGain();
      gain.gain.value = 0;
      const pan = typeof a.createStereoPanner === "function" ? a.createStereoPanner() : null;
      src.connect(filter);
      filter.connect(gain);
      if (pan) {
        gain.connect(pan);
        pan.connect(a.destination);
      } else gain.connect(a.destination);
      src.start();
      bed = { a, src, filter, gain, pan };
      return bed;
    } catch {
      bed = null;
      return null;
    }
  }

  function setBed(gain: number, freq: number, pan: number): void {
    const b = bed;
    if (!b) return;
    const t = b.a.currentTime;
    b.gain.gain.setTargetAtTime(gain, t, 0.06);
    b.filter.frequency.setTargetAtTime(freq, t, 0.06);
    if (b.pan) b.pan.pan.setTargetAtTime(pan, t, 0.1);
  }

  return {
    grab() {
      if (!ctx()) return;
      ensure();
      noise(0, 0.04, 2600, 1400, 0.1);
      tone(240, 0, 0.08, "triangle", 0.09, 150);
    },
    release() {
      // nothing of its own: the whoosh follows the speed the table keeps
    },
    update(step) {
      if (!bed && !(step.active && ctx())) return;
      if (!bed) ensure();
      if (!bed) return;
      if (!sound) {
        if (lastGain >= 0.001) setBed(0, 300, 0);   // muted: the bed stays open but silent, so it is there if the child unmutes
        lastGain = 0;
        return;
      }
      const w = whooshFor(step.speed, idle, reduce);
      if (w.gain >= 0.001 || lastGain >= 0.001) setBed(w.gain, w.freq, w.pan);   // a silent bed that stays silent is left alone (no automation every frame at idle)
      lastGain = w.gain;
      for (let i = 0; i < Math.min(step.ticks, 3); i++) if (tickAudible(step, reduce)) tone(1050 + (i % 2) * 120, 0, 0.03, "triangle", 0.035, 780);
      if (step.settled && !reduce) tone(190, 0, 0.16, "sine", 0.07, 110);
    },
    quiet() {
      if (bed && lastGain >= 0.001) setBed(0, 300, 0);
      lastGain = 0;
    },
  };
}
