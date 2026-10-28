// WebAudio loop player with crossfades. Loops are pre-made patterns in
// shared/liveplay.ts (synth stand-ins for Mureka stems); switching mood
// crossfades gain over ~0.8s so the music follows the story without a
// hard cut. Nothing is generated musically at request time.
import { MOOD_LOOPS, semitoneHz, type Mood, type MoodLoop } from "../../../shared/liveplay";

export interface LoopPlayer {
  setMood: (mood: Mood) => void;
  stop: () => void;
  started: Promise<boolean>;
}

const CROSSFADE_S = 0.8;
const LOOKAHEAD_S = 0.35;

interface Voice {
  loop: MoodLoop;
  gain: GainNode;
  nextBeatAt: number;
  beat: number;
  dead: boolean;
}

export function createLoopPlayer(initial: Mood): LoopPlayer {
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return { setMood: () => {}, stop: () => {}, started: Promise.resolve(false) };

  const ctx = new Ctor();
  const master = ctx.createGain();
  master.gain.value = 0.14;
  master.connect(ctx.destination);

  const voices: Voice[] = [];
  let timer: number | undefined;

  const startVoice = (mood: Mood, fadeIn: boolean): Voice => {
    const gain = ctx.createGain();
    gain.gain.value = fadeIn ? 0 : 1;
    gain.connect(master);
    if (fadeIn) gain.gain.linearRampToValueAtTime(1, ctx.currentTime + CROSSFADE_S);
    const voice: Voice = { loop: MOOD_LOOPS[mood], gain, nextBeatAt: ctx.currentTime + 0.06, beat: 0, dead: false };
    voices.push(voice);
    return voice;
  };

  const note = (voice: Voice, semitone: number, at: number, dur: number, level: number) => {
    const osc = ctx.createOscillator();
    osc.type = voice.loop.wave;
    osc.frequency.value = semitoneHz(voice.loop.rootHz, semitone);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    osc.connect(g).connect(voice.gain);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  };

  const schedule = () => {
    for (const voice of voices) {
      if (voice.dead) continue;
      const beatS = 60 / voice.loop.bpm;
      while (voice.nextBeatAt < ctx.currentTime + LOOKAHEAD_S) {
        const i = voice.beat % 8;
        const mel = voice.loop.melody[i]!;
        const bass = voice.loop.bassPattern[i]!;
        if (mel >= 0) note(voice, mel, voice.nextBeatAt, beatS * 0.9, 0.8);
        if (bass >= 0) note(voice, bass, voice.nextBeatAt, beatS * 1.6, 0.5);
        voice.nextBeatAt += beatS;
        voice.beat++;
      }
    }
  };

  const started = ctx.resume().then(() => {
    if (ctx.state !== "running") return false;
    startVoice(initial, false);
    timer = window.setInterval(schedule, 100);
    schedule();
    return true;
  }).catch(() => false);

  return {
    started,
    setMood: (mood) => {
      const current = voices.find((v) => !v.dead);
      if (current?.loop.mood === mood) return;
      if (current) {
        current.dead = true;
        current.gain.gain.cancelScheduledValues(ctx.currentTime);
        current.gain.gain.setValueAtTime(current.gain.gain.value, ctx.currentTime);
        current.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + CROSSFADE_S);
        const dying = current;
        window.setTimeout(() => dying.gain.disconnect(), CROSSFADE_S * 1000 + 200);
      }
      startVoice(mood, true);
    },
    stop: () => {
      if (timer !== undefined) window.clearInterval(timer);
      void ctx.close().catch(() => {});
    },
  };
}
