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
//   dances()                 [{ id, bpm, beats, group, label }] every clip that carries a tempo: the dances (picked by the tempo), and the movement-break
//                            moves and the guitar strum (offered only when a child chooses them in the Dance picker)
//   label(id)                the clip's menu label
//   playClip(id)             start the clip the way the menu does
//   holdClip(id, seconds)    freeze the clip at that time (called every frame while dancing)
//   releaseClip(id)          let the clip and the rest pose run again
//   activeClip()             the id of the clip now playing (a different one means the child chose something else: the party ends)
//   headphones.wear()        puts the headphones on; true if this head can wear them. headphones.restore() puts the old crown back
//   glow(level, beatIndex)   0 to 1 flash on the headphones (0 clears it)
//   ring(level, downbeat)    0 to 1 flash on the floor ring (0 clears it)
//   band()                   the age band 0 to 5
//   loadSongIndex()          Promise of the starter library's index.json (raw: it is checked here before anything is played), or null
//   loadSongData(file)       Promise of a song file's bytes (an ArrayBuffer)
// No storage, and no network of its own: the bench fetches, the glue only decides.
import {
  MOODS,
  TEMPOS,
  TEMPO_BPM,
  beatPlayFor,
  buildSongRequest,
  danceForMix,
  fittingClips,
  loopEvents,
  midiToHz,
  mixList,
  newTapRun,
  parseSongIndex,
  partyFrame,
  planParty,
  practiceBeatMap,
  registerTap,
  songBeatMap,
  songInterval,
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
    song: 'practice', songs: [], note: '', ended: '', bufferSeconds: 0,
    dance: 'auto', playing: null, bpm: TEMPO_BPM.medium, plan: null, map: null, run: null, frame: null, frameT: -Infinity,
    worn: false, flash: 0, lastOutcome: null,
  };
  const now = () => performance.now(); // only ever used to ask the audio clock where the song is; the party keeps no time of its own

  function onTap(ev) {
    if (!st.on) return;
    const at = Number.isFinite(ev?.timeStamp) && ev.timeStamp > 0 ? ev.timeStamp : now();
    api.tap(at);
  }
  host.stage?.addEventListener('pointerdown', onTap);
  // The starter library: whatever the index lists and passes the checks. A missing or broken index leaves just the practice beat.
  Promise.resolve(host.loadSongIndex ? host.loadSongIndex() : null)
    .then((raw) => { if (raw) st.songs = parseSongIndex(raw).songs; })
    .catch(() => { st.songs = []; });
  // a hidden page plays no party: the sound would go on with nobody looking, and a phone locked mid-dance should not keep playing
  const onVisibility = () => { if (typeof document !== 'undefined' && document.hidden) api.stop('hidden'); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  /** The clip the child chose, or null for Auto. */
  const chosenId = () => (st.dance === 'auto' ? null : st.dance);
  /** The tempo the party is (or would be) at: the running song's, else the tempo card's. */
  const chosenSong = () => (st.song === 'practice' ? null : st.songs.find((x) => x.id === st.song) ?? null);
  const currentBpm = () => (st.on || st.starting ? st.bpm : chosenSong() ? chosenSong().bpm : TEMPO_BPM[st.tempo]);
  /** What the Dance picker offers at this tempo: Auto, then every clip that fits it (nearest its natural speed first), each with the speed it would play at. */
  function danceOptions() {
    const fit = fittingClips(currentBpm(), host.dances());
    return [
      { value: 'auto', label: 'Auto (the tempo picks)' },
      // a Mix takes turns with the dances that fit, so it needs at least two
      ...(mixList(currentBpm(), host.dances()).length >= 2 ? [{ value: 'mix', label: 'Mix (a new dance every 4 bars)' }] : []),
      ...fit.map(({ clip, rate }) => ({ value: clip.id, label: `${host.label(clip.id)} (${clip.group === 'dance' || !clip.group ? '' : clip.group + ', '}×${rate.toFixed(2)})` })),
    ];
  }
  /** A chosen clip that no longer fits the tempo goes back to Auto (a move is never stretched to a tempo it does not fit). */
  function dropChoiceIfUnfit() {
    if (st.dance === 'mix') { if (mixList(currentBpm(), host.dances()).length < 2) st.dance = 'auto'; return; }
    if (st.dance !== 'auto' && !fittingClips(currentBpm(), host.dances()).some((f) => f.clip.id === st.dance)) st.dance = 'auto';
  }

  /**
   * Re-plan while the party plays (the child picked another dance): the sound keeps going, the old clip is let go and the new one takes over on the
   * same song clock, so it is on the beat from its first frame.
   */
  function replan() {
    if (!st.on || !st.plan) return;
    const before = st.playing;
    st.plan = planParty(st.bpm, host.dances(), 0, chosenId());
    // a Mix opens on whichever of its dances this beat belongs to, not on its first, so the next frame does not swap again
    const after = st.plan.mix ? danceForMix(st.plan.mix.list, st.frame ? st.frame.place.position : 0, st.plan.mix.every).clip.id : (st.plan.dance?.clip.id ?? null);
    if (before === after) return;
    if (before) host.releaseClip(before);
    if (after) host.playClip(after);
    st.playing = after;
    st.frame = null;
  }

  async function start() {
    if (st.on || st.starting) return false;
    const song = chosenSong();
    const req = buildSongRequest({ mood: st.mood, tempo: st.tempo });
    if (!req.ok) return false;
    st.starting = true;
    st.note = '';
    audio.unlock(); // inside the tap, before anything is fetched (see unlock): a song's file has to be awaited and Safari would not start sound after that
    try {
      st.bpm = song ? 60 / songInterval(song) : req.bpm;
      st.plan = planParty(st.bpm, host.dances(), 0, chosenId());
      st.map = song ? songBeatMap(song, PARTY_SECONDS) : practiceBeatMap(req.bpm, PARTY_SECONDS);
      st.run = newTapRun(st.band);
      // the file is fetched BEFORE anything on the rig changes, so a song that cannot be had leaves Kip exactly as he was
      const data = song ? await host.loadSongData(song.file) : null;
      st.worn = Boolean(host.headphones?.wear());
      st.playing = st.plan.dance ? st.plan.dance.clip.id : null;
      if (st.playing) host.playClip(st.playing);
      if (song) st.bufferSeconds = (await audio.startSong({ data, offset: song.offset, interval: songInterval(song), loopSeconds: song.dur })).bufferSeconds;
      else await audio.start({ mood: st.mood, bpm: req.bpm });
      st.on = true;
      st.flash = 0;
      st.lastOutcome = null;
      return true;
    } catch (err) {
      console.warn('party could not start', err);
      st.ended = 'error';
      const why = String(err && err.message ? err.message : err).slice(0, 90);
      st.note = song ? `The song could not be played (${why}): the practice beat is still here.` : `The party could not start (${why}).`;
      finish();
      return false;
    } finally {
      st.starting = false;
    }
  }

  /** Everything undone: sound off, the clip released, the glow cleared, the old crown back. Safe to call twice. */
  function finish(reason = 'switch') {
    const wasDancing = st.playing;
    st.ended = reason; // why the party ended (the switch, another clip, a hidden page, the Workshop tab, the ten minutes, an error): `state().ended`, for "it stopped by itself"
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
    st.playing = null;
  }

  function stop(reason = 'switch') {
    if (!st.on && !st.starting) return;
    finish(reason);
  }

  function update(dt) {
    st.flash = Math.max(0, st.flash - dt * 5);
    if (!st.on) return;
    // The browser refreshes its output position now and then and the estimate between refreshes can land a few milliseconds behind the last frame: the DANCE
    // never steps backwards (the audio is untouched, and a tap is timed from its own event, not from this).
    const t = Math.max(audio.songTime(now()), st.frameT);
    if (t > PARTY_SECONDS - 1) { stop('time'); return; }
    const f = partyFrame(st.plan, st.map, t);
    st.frame = f;
    st.frameT = t;
    if (f.danceId) {
      // the Mix has reached its next dance (a bar line, every 16 beats): let the old one go and bring in the new, which crossfades
      if (st.playing && f.danceId !== st.playing) {
        host.releaseClip(st.playing);
        host.playClip(f.danceId);
        st.playing = f.danceId;
      }
      if (host.activeClip() !== f.danceId) { stop('other-clip'); return; } // the child picked another clip: the party is over
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
    if (!st.on && !st.starting) return st.note || 'Pick a song (or the practice beat), the ages and a dance, then switch Party on. Tap the stage on the beat.';
    const plan = st.plan;
    const dance = st.playing ? `${host.label(st.playing)}${plan?.mix ? ' (mix)' : ''}` : 'lights only (no dance fits this tempo)';
    const f = st.frame;
    const sum = st.run ? tapSummary(st.run) : { taps: 0, hits: 0 };
    const play = beatPlayFor(st.band);
    const tapNote = play.judged ? `on the beat ${sum.hits}/${sum.taps}` : `taps ${sum.taps}`;
    const heads = st.worn ? '' : ' · no headphones on this head';
    const song = chosenSong();
    const source = song ? `${song.title} (made by AI)` : 'practice beat';
    return `${source} · ${dance} · ${Math.round(st.bpm)} bpm · ${f ? f.count : '–'} · ${tapNote}${heads}`;
  }

  function state() {
    const f = st.frame;
    const sum = st.run ? tapSummary(st.run) : { taps: 0, hits: 0, meanAbsErrorMs: 0 };
    return {
      on: st.on, ended: st.ended, startedAt: audio.startedAt, bufferSeconds: st.bufferSeconds, song: st.song, songs: st.songs.map((x) => x.id), click: audio.isClick(), note: st.note, mood: st.mood, tempo: st.tempo, band: st.band, bpm: st.bpm, dance: st.dance, chosen: Boolean(st.plan?.chosen), fellBack: Boolean(st.plan?.fellBack),
      danceId: st.playing ?? st.plan?.dance?.clip.id ?? null, mix: Boolean(st.plan?.mix), lightsOnly: Boolean(st.plan && !st.plan.dance),
      headphones: st.worn, songTime: st.on ? audio.songTime(now()) : 0,
      count: f ? f.count : null, pulse: f ? f.pulse : 0, danceTime: f ? f.danceTime : null, frameSongTime: Number.isFinite(st.frameT) ? st.frameT : 0,
      taps: sum.taps, hits: sum.hits, meanAbsErrorMs: sum.meanAbsErrorMs, lastOutcome: st.lastOutcome, mode: st.run?.mode ?? null,
      gain: audio.getGain(),
    };
  }

  const api = {
    start, stop: (reason) => stop(reason), update, tap, state,
    /** 'practice' or a library song's id. */
    setSong(id) { if (id === 'practice' || st.songs.some((x) => x.id === id)) { st.song = id; dropChoiceIfUnfit(); restartIfOn(); } },
    setClick(on) { audio.setClick(Boolean(on)); },
    setMood(m) { if (MOODS.includes(m)) { st.mood = m; restartIfOn(); } },
    setTempo(t) { if (TEMPOS.includes(t)) { st.tempo = t; dropChoiceIfUnfit(); restartIfOn(); } },
    /** 'auto', 'mix' or a clip id from the picker. A clip that does not fit the tempo is ignored (the picker never offers one), and so is a mix when fewer than two dances fit. */
    setDance(id) {
      const ok = id === 'auto' || (id === 'mix' && mixList(currentBpm(), host.dances()).length >= 2) || fittingClips(currentBpm(), host.dances()).some((f) => f.clip.id === id);
      if (ok) { st.dance = id; replan(); }
    },
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
      songs: () => [{ value: 'practice', label: 'Practice beat (made here)' }, ...st.songs.map((x) => ({ value: x.id, label: `${cap(x.mood)}: ${x.title} (${Math.round(x.bpm)})` }))],
      song: () => (chosenSong() ? st.song : 'practice'),
      click: () => audio.isClick(),
      setClick: (on) => api.setClick(on),
      setSong: (id) => api.setSong(id),
      mood: () => st.mood,
      tempo: () => st.tempo,
      dances: danceOptions,
      dance: () => { dropChoiceIfUnfit(); return st.dance; },
      band: () => String(st.band),
      start, stop: () => stop('switch'),
      setMood: (m) => api.setMood(m),
      setTempo: (t) => api.setTempo(t),
      setDance: (d) => api.setDance(d),
      setBand: (b) => api.setBand(Number(b)),
      status: describe,
    },
  };
  return api;
}
