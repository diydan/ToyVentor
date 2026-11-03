// "My songs" for the dance party: the child's own theme songs (kept by kip-theme-song.js) offered in the party's Song picker, so Kip can dance to them.
//
//   const mine = createMySongs({ onChange: () => party.refreshSongs() });
//   mine.entries()      library-shaped index entries for every kept song that could be measured (what the party's loadSongIndex adds to the starter songs)
//   await mine.add(s)   measure one newly kept song (fetch its audio, decode, find the beat, plan the cut), remember the result, tell `onChange`
//   await mine.data(f)  the cut of that song as WAV bytes, for the party's loadSongData (file names are `my_<task>.mp3`: only a NAME, never a path or a link)
//   mine.catchUp()      measure up to a few kept songs that were never measured (made before this existed), one after another
//
// WHY IN THE BROWSER. A starter song is measured and cut by a script (ffmpeg) before it ships; a theme song is made while a child plays. The same steps run here on
// the decoded samples (shared/themeParty.ts, bundled as kip-theme-core.js): measure the beat, pick the whole bars that end before Mureka's appended watermark,
// cut them to a WAV that loops exactly on its beat grid. The result is an index entry in the library's own shape, so the party checks it with the same checker.
//
// WHERE THE AUDIO COMES FROM. The app's own route relays it (`/api/theme-song?id=<task>&audio=1`): the provider's file host sends no CORS headers, so a page
// cannot decode the audio from there. A song that cannot be fetched or measured is simply not offered for dancing (it still plays on its card).
//
// STORAGE. The measuring result per song (not the audio) is kept in localStorage under `tv.themeSongBeats.v1`, so the Song picker is complete on the next visit
// without fetching anything. Blocked storage means it is measured again each visit.
import { analyseTheme, cutToWav, themeIndexEntry, themeSongId } from './kip-theme-core.js?v=10.0';
import { readSongs } from './kip-theme-song.js';

const BEATS_KEY = 'tv.themeSongBeats.v1';
const DECODE_RATE = 44100;

const read = (storage) => { try { const v = JSON.parse(storage?.getItem(BEATS_KEY) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const write = (storage, map) => { try { storage?.setItem(BEATS_KEY, JSON.stringify(map)); } catch { /* blocked: measured again next visit */ } };

export function createMySongs({
  fetchImpl = globalThis.fetch, storage = globalThis.localStorage, audioUrl = (task) => `/api/theme-song?id=${encodeURIComponent(task)}&audio=1`,
  OfflineAudioContextClass = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext, onChange = () => {},
} = {}) {
  const inflight = new Map();   // task -> the promise of its measuring: one at a time per song
  const cuts = new Map();       // task -> { channels, sampleRate, cut }: the decoded song, kept for the party's start (this page's life only)

  const retryable = (message) => Object.assign(new Error(message), { retryable: true });

  /** Fetch and decode a song's audio. A failure to GET it (offline, not ready, the route is off) is `retryable`: nothing is remembered and it is tried another time.
   *  Only a file that arrived and cannot be decoded (or has no beat) is remembered as "cannot be danced to". */
  async function decode(task) {
    let bytes;
    try {
      const res = await fetchImpl(audioUrl(task));
      if (!res.ok) throw retryable(`audio ${res.status}`);
      bytes = await res.arrayBuffer();
    } catch (err) {
      throw err && err.retryable ? err : retryable(`audio fetch failed: ${err && err.message ? err.message : err}`);
    }
    if (!OfflineAudioContextClass) throw retryable('no audio decoder here');   // a browser without one: nothing to remember, a different browser may have it
    const ctx = new OfflineAudioContextClass(2, 1, DECODE_RATE);
    const buf = await ctx.decodeAudioData(bytes.slice(0));
    const channels = [];
    for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
    return { channels, sampleRate: buf.sampleRate, bytes: bytes.byteLength };
  }

  async function measure(kept) {
    const task = String(kept.task ?? '');
    if (!/^\d{6,24}$/.test(task)) return null;
    if (inflight.has(task)) return inflight.get(task);
    const job = (async () => {
      try {
        const d = await decode(task);
        const planned = analyseTheme(d.channels, d.sampleRate);
        const map = read(storage);
        if (planned.ok) {
          map[task] = { ok: true, entry: themeIndexEntry({ task, name: kept.name, mood: kept.mood }, planned.cut, d.bytes) };
          cuts.set(task, { channels: d.channels, sampleRate: d.sampleRate, cut: planned.cut });
        } else map[task] = { ok: false, reason: planned.reason };
        write(storage, map);
        return map[task];
      } catch (err) {
        if (err && err.retryable) return null;   // not ready or not reachable: try again another time, remember nothing
        const map = read(storage);
        map[task] = { ok: false, reason: 'decode' };
        write(storage, map);
        return map[task];
      } finally {
        inflight.delete(task);
      }
    })();
    inflight.set(task, job);
    return job;
  }

  const api = {
    /** Index entries for every kept song that was measured and can be danced to, newest first. */
    entries() {
      const map = read(storage);
      return readSongs(storage).map((s) => map[String(s.task)]).filter((m) => m && m.ok).map((m) => m.entry);
    },
    async add(kept) {
      const r = await measure(kept);
      if (r && r.ok) onChange();
      return r;
    },
    /** The cut as WAV bytes. Throws when the song is not one of ours or cannot be had: the party then leaves Kip as he was and says so. */
    async data(file) {
      const m = /^my_(\d{6,24})\.mp3$/.exec(String(file));
      if (!m) throw new Error(`not one of your songs: ${file}`);
      const task = m[1];
      let c = cuts.get(task);
      if (!c) {
        const d = await decode(task);
        const planned = analyseTheme(d.channels, d.sampleRate);
        if (!planned.ok) throw new Error(`this song cannot be danced to (${planned.reason})`);
        c = { channels: d.channels, sampleRate: d.sampleRate, cut: planned.cut };
        cuts.set(task, c);
      }
      return cutToWav(c.channels, c.sampleRate, c.cut);
    },
    /** Measure up to `limit` kept songs that were never measured (songs made before this existed, or while the audio could not be fetched). */
    async catchUp(limit = 4) {
      const map = read(storage);
      let changed = false;
      for (const s of readSongs(storage).filter((k) => !map[String(k.task)]).slice(0, limit)) {
        const r = await measure(s);
        if (r && r.ok) changed = true;
      }
      if (changed) onChange();
    },
    id: themeSongId,
  };
  return api;
}
