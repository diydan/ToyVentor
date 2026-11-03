// Party mode for the Kip bench (docs/specs/dance-party-spec.md 5.1, phase 3): pick a mood and a tempo, Kip puts on the headphones, a practice beat plays, and Kip
// dances ON the beat while the headphones glow. A tap on the stage plays along, by age band.
//
// This file is the glue. The decisions (which dance a tempo fits, where in the dance a moment of the song falls, what a tap did) are pure and tested in
// shared/songParty.ts, reached through the bundled kip-party-core.js; the sound is kip-party-audio.js. Everything here reads ONE clock, the audio
// clock, through `audio.songTime()`: the sound, the dance, the glow and the tap judge cannot drift apart because they never keep time on their own.
//
//   const party = mountParty({ AudioContextClass, stage, dances, label, playClip, holdClip, releaseClip, activeClip, headphones, glow, ring, band });
//   party.update(dt)      once a frame, BEFORE the animation mixer runs
//   party.start() / stop() / setMood() / setTempo() / setBand() / dispose()
//   party.menu            what the menu's Party group reads (buildPartyGroup in kip-menu.js)
//
// `host` is the bench's side (it owns the rig):
//   dances()                 [{ id, bpm, beats }] the clips that carry a tempo (procedural and baked dances)
//   label(id)                the clip's menu label
//   playClip(id)             start the clip the way the menu does
//   holdClip(id, seconds)    freeze the clip at that time (called every frame while dancing)
//   releaseClip(id)          let the clip and the rest pose run again
//   activeClip()             the id of the clip now playing (a different one means the child chose something else: the party ends)
//   headphones.wear()        puts the headphones on; true if this head can wear them. headphones.restore() puts the old crown back
//   glow(level, beatIndex)   0 to 1 flash on the headphones (0 clears it)
//   ring(level, downbeat)    0 to 1 flash on the floor ring (0 clears it)
//   band()                   the age band 0 to 5
// No storage, no network.
import {
  MOODS,
  TEMPOS,
  TEMPO_BPM,
  beatPlayFor,
  buildSongRequest,
  loopEvents,
  midiToHz,
  newTapRun,
  partyFrame,
  planParty,
  practiceBeatMap,
  registerTap,
  tapFlashes,
  tapSummary,
} from './kip-party-core.js?v=10.0';
import { createPartyAudio } from './kip-party-audio.js?v=10.0';

/** What the picker shows for each age band (src/lib/age.ts BANDS; a test keeps the two in step). */
export const PARTY_BANDS = ['2–3', '3–4', '5–6', '7–9', '10–12', '13+'];
/** The practice beat plays this long, then the party ends by itself. */
export const PARTY_SECONDS = 600;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function mountParty(host) {
  const audio = createPartyAudio({ AudioContextClass: host.AudioContextClass, loopEvents, midiToHz });
  const st = {
    on: false, starting: false,
    mood: 'bouncy', tempo: 'medium', band: Number.isInteger(host.band?.()) ? host.band() : 1,
    bpm: TEMPO_BPM.medium, plan: null, map: null, run: null, frame: null, frameT: -Infinity,
    worn: false, flash: 0, lastOutcome: null,
  };
  const now = () => performance.now(); // only ever used to ask the audio clock where the song is; the party keeps no time of its own

  function onTap(ev) {
    if (!st.on) return;
    const at = Number.isFinite(ev?.timeStamp) && ev.timeStamp > 0 ? ev.timeStamp : now();
    api.tap(at);
  }
  host.stage?.addEventListener('pointerdown', onTap);
  // a hidden page plays no party: the sound would go on with nobody looking, and a phone locked mid-dance should not keep playing
  const onVisibility = () => { if (typeof document !== 'undefined' && document.hidden) api.stop(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  async function start() {
    if (st.on || st.starting) return false;
    const req = buildSongRequest({ mood: st.mood, tempo: st.tempo });
    if (!req.ok) return false;
    st.starting = true;
    try {
      st.bpm = req.bpm;
      st.plan = planParty(req.bpm, host.dances());
      st.map = practiceBeatMap(req.bpm, PARTY_SECONDS);
      st.run = newTapRun(st.band);
      st.worn = Boolean(host.headphones?.wear());
      if (st.plan.dance) host.playClip(st.plan.dance.clip.id);
      await audio.start({ mood: st.mood, bpm: req.bpm });
      st.on = true;
      st.flash = 0;
      st.lastOutcome = null;
      return true;
    } catch (err) {
      console.warn('party could not start', err);
      finish();
      return false;
    } finally {
      st.starting = false;
    }
  }

  /** Everything undone: sound off, the clip released, the glow cleared, the old crown back. Safe to call twice. */
  function finish() {
    const wasDancing = st.plan?.dance?.clip.id;
    st.on = false;
    audio.stop();
    if (wasDancing) host.releaseClip(wasDancing);
    host.glow(0, 0);
    host.ring(0, false);
    if (st.worn) host.headphones?.restore();
    st.worn = false;
    st.flash = 0;
    st.frame = null;
    st.frameT = -Infinity;
  }

  function stop() {
    if (!st.on && !st.starting) return;
    finish();
  }

  function update(dt) {
    st.flash = Math.max(0, st.flash - dt * 5);
    if (!st.on) return;
    // The browser refreshes its output position now and then and the estimate between refreshes can land a few milliseconds behind the last frame: the DANCE
    // never steps backwards (the audio is untouched, and a tap is timed from its own event, not from this).
    const t = Math.max(audio.songTime(now()), st.frameT);
    if (t > PARTY_SECONDS - 1) { stop(); return; }
    const f = partyFrame(st.plan, st.map, t);
    st.frame = f;
    st.frameT = t;
    if (f.danceId) {
      if (host.activeClip() !== f.danceId) { stop(); return; } // the child picked another clip: the party is over
      host.holdClip(f.danceId, f.danceTime);
    }
    const level = Math.max(f.pulse, st.flash);
    host.glow(level, f.place.index);
    host.ring(level, f.downbeat);
  }

  /** A tap, at `perfMs` on the performance clock (an input event's timeStamp). Returns what it did, or null when no party is on. */
  function tap(perfMs) {
    if (!st.on || !st.run) return null;
    const o = registerTap(st.run, st.map, audio.songTime(perfMs ?? now()));
    if (tapFlashes(o)) st.flash = 1;
    st.lastOutcome = o;
    return o;
  }

  async function restartIfOn() {
    if (st.on || st.starting) { stop(); await start(); }
  }

  function describe() {
    if (!st.on && !st.starting) return 'Pick a mood, a tempo and the ages, then switch Party on. Tap the stage on the beat.';
    const plan = st.plan;
    const dance = plan?.dance ? host.label(plan.dance.clip.id) : 'lights only (no dance fits this tempo)';
    const f = st.frame;
    const sum = st.run ? tapSummary(st.run) : { taps: 0, hits: 0 };
    const play = beatPlayFor(st.band);
    const tapNote = play.judged ? `on the beat ${sum.hits}/${sum.taps}` : `taps ${sum.taps}`;
    const heads = st.worn ? '' : ' · no headphones on this head';
    return `${dance} · ${Math.round(st.bpm)} bpm · ${f ? f.count : '–'} · ${tapNote}${heads}`;
  }

  function state() {
    const f = st.frame;
    const sum = st.run ? tapSummary(st.run) : { taps: 0, hits: 0, meanAbsErrorMs: 0 };
    return {
      on: st.on, mood: st.mood, tempo: st.tempo, band: st.band, bpm: st.bpm,
      danceId: st.plan?.dance?.clip.id ?? null, lightsOnly: Boolean(st.plan && !st.plan.dance),
      headphones: st.worn, songTime: st.on ? audio.songTime(now()) : 0,
      count: f ? f.count : null, pulse: f ? f.pulse : 0, danceTime: f ? f.danceTime : null, frameSongTime: Number.isFinite(st.frameT) ? st.frameT : 0,
      taps: sum.taps, hits: sum.hits, meanAbsErrorMs: sum.meanAbsErrorMs, lastOutcome: st.lastOutcome, mode: st.run?.mode ?? null,
      gain: audio.getGain(),
    };
  }

  const api = {
    start, stop, update, tap, state,
    setMood(m) { if (MOODS.includes(m)) { st.mood = m; restartIfOn(); } },
    setTempo(t) { if (TEMPOS.includes(t)) { st.tempo = t; restartIfOn(); } },
    setBand(b) { if (Number.isInteger(b) && b >= 0 && b < PARTY_BANDS.length) { st.band = b; if (st.run) st.run = newTapRun(b); } },
    setGain: (g) => audio.setGain(g),
    dispose() {
      stop();
      host.stage?.removeEventListener('pointerdown', onTap);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    },
    /** What the menu's Party group reads. */
    menu: {
      isOn: () => st.on || st.starting,
      moods: MOODS.map((m) => ({ value: m, label: cap(m) })),
      tempos: TEMPOS.map((t) => ({ value: t, label: `${cap(t)} (${TEMPO_BPM[t]})` })),
      bands: PARTY_BANDS.map((label, i) => ({ value: String(i), label })),
      mood: () => st.mood,
      tempo: () => st.tempo,
      band: () => String(st.band),
      start, stop,
      setMood: (m) => api.setMood(m),
      setTempo: (t) => api.setTempo(t),
      setBand: (b) => api.setBand(Number(b)),
      status: describe,
    },
  };
  return api;
}
