// "Make a song about it" at the end of a level, and the dance party that follows (Dan, 2026-11-03: "once a song is done at the end of the level start an in-game dance
// party"). The steps, in order, each a state the card shows:
//
//   writing   ask the app's own route (worker/themeSong.ts, kind "level") for a NAME and the words; they arrive in seconds
//   making    the song is being sung (about a minute); the name and the words are on screen meanwhile
//   ready     the song is finished: its audio comes through the route's relay, is decoded, MEASURED and cut to whole bars (shared/themeParty.ts)
//   dancing   the party starts (runtime/gameParty.ts): the character dances ON the beat while the song plays
//   over      the party ended (stopped, or its time was up): a child can dance again or close the card
//   failed    something did not work: a kind sentence, the name and the words are kept if there were any
// A song that cannot be cut to dance to (no steady beat) is not a dead end: `fallbackUrl` lets the card play it as a plain song.
//
// QUIET WHEN ABSENT. `isOn()` is one free GET (never spends); a Worker with theme songs off, a static server, or any error answers false and the card is never offered.
// The finished song is also kept in this browser's "My songs" list (the same key and shape the Kip bench's Describe card uses), so the Kip party can dance to it too.
//
// DEPENDENCIES ARE INJECTED so every step is tested without a browser or a network.
import { analyseTheme, cutToWav, themeIndexEntry } from "../../../../shared/themeParty";
import { cleanLines, lyricsForCut, type CutLine, type LyricLine } from "../../../../shared/songKaraoke";

export type FlowPhase = "idle" | "writing" | "making" | "ready" | "dancing" | "over" | "failed";
export type FlowKind = "build" | "level" | "prompt";

/** What the route says a device has left this week (worker/songStore.ts statusFor). */
export interface SongQuota {
  limit: number;
  used: number;
  left: number;
  /** The Monday the songs come back, "YYYY-MM-DD". */
  resetsOn: string;
  /** False when a grown-up switched songs off for this device. */
  makerOn: boolean;
}

export interface FlowState {
  phase: FlowPhase;
  name: string;
  verse: string[];
  chorus: string[];
  /** One kind sentence for the child. */
  note: string;
  /** A plain link to the finished song, set when it could not be cut to dance to. */
  fallbackUrl: string;
  /** Songs left this week, once the route has said. */
  quota: SongQuota | null;
  /** True while the party is held (paused) and can carry on. */
  paused: boolean;
  /** The words with their times on the cut the party loops, for the karaoke. Empty when the provider gave no times (the card then shows the words only). */
  karaoke: CutLine[];
  /** Seconds of one loop of the cut (0 until the song is measured). */
  loop: number;
}

export interface FlowDeps {
  fetchImpl: typeof fetch;
  /** Decode an audio file's bytes (the browser's own decoder). */
  decode(bytes: ArrayBuffer): Promise<{ channels: ArrayLike<number>[]; sampleRate: number }>;
  /** Start the party with the checked entry and the WAV cut; resolves how it went. */
  startParty(song: { entry: unknown; wav: ArrayBuffer; title: string }): Promise<{ ok: boolean; dancing?: boolean; reason?: string }>;
  /** Hold the party where it is / carry on (false when there is no party to hold). */
  pauseParty?(): boolean;
  resumeParty?(): boolean;
  /**
   * True while the party must NOT start by itself: the song is made, measured and cut, the phase stays "ready" with the karaoke times and the loop length set, and the party starts when
   * the page calls `again()` (the new-player setup: Kip dances only once the player picks up the headphones). Asked when the song is ready, so it can change while the song is being made.
   */
  holdParty?(): boolean;
  onState(state: FlowState): void;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** Headers every request carries: the device id and the family's time zone (the week turns on its own Monday). */
  headers?: () => Record<string, string>;
  /** One per tap of "make my song": a retry of the same tap reuses it, so the route spends nothing twice. */
  newKey?: () => string;
  url?: string;
  pollMs?: number;
  maxWaitMs?: number;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}

const LIST_KEY = "tv.themeSongs.v1";
const MAX_KEPT = 20;
const POLL_MS = 4000;
const MAX_WAIT_MS = 6 * 60 * 1000;
const MAX_POLL_FAILS = 6;
const MAX_DESCRIPTION = 300;
/** The route pings the model at most every four minutes anyway; asking more often than every three is pointless. */
const WARM_CLIENT_MS = 3 * 60_000;

/** What a child did, in words the song writer can use, by the kind of mission they finished (src/lib/progression.ts MissionType). */
const LEVEL_WORDS: Readonly<Record<string, string>> = {
  bridge: "building a bridge",
  lift: "lifting something heavy",
  lever: "using a lever",
  raft: "building a raft and sailing it",
  circuit: "lighting up a circuit",
  code: "writing code for my toy",
  pattern: "finding a pattern",
  logic: "solving a puzzle",
  measure: "measuring things",
  balance: "balancing a scale",
  clean: "cleaning up a messy table",
};
/** The sentence sent to the song writer for a finished mission. Nothing else about the child or the game goes with it. */
export function levelDescription(missionType: string): string {
  return `I finished ${LEVEL_WORDS[missionType] ?? "a game level"} with my toy.`.slice(0, MAX_DESCRIPTION);
}

const EMPTY: FlowState = { phase: "idle", name: "", verse: [], chorus: [], note: "", fallbackUrl: "", quota: null, paused: false, karaoke: [], loop: 0 };

export interface KeptSong {
  name: string;
  verse: string[];
  chorus: string[];
  mood: string;
  url: string;
  task: string;
  madeAt: string;
  /** The provider's timed lines, kept so a song played again later still has its karaoke (the Kip bench ignores the field). */
  lines?: LyricLine[];
  /** What the song was made for: "prompt" is the new player's own theme song (the title page plays it), "level" and "build" are the end-of-level and Build songs. Songs kept before this have none. */
  kind?: FlowKind;
}
/** Keep a finished song in this browser's list (newest first, at most 20). Never throws: blocked storage means the song plays this visit only. */
export function keepSong(storage: FlowDeps["storage"], song: KeptSong): void {
  try {
    let list: KeptSong[] = [];
    try {
      const raw = JSON.parse(storage?.getItem(LIST_KEY) ?? "[]") as unknown;
      list = Array.isArray(raw) ? (raw as KeptSong[]).filter((s) => s && typeof s.name === "string" && typeof s.url === "string") : [];
    } catch { list = []; }
    storage?.setItem(LIST_KEY, JSON.stringify([song, ...list.filter((s) => s.task !== song.task)].slice(0, MAX_KEPT)));
  } catch { /* blocked: this visit only */ }
}

/** The songs kept in this browser, newest first. Never throws: blocked or damaged storage is an empty list. */
export function readKeptSongs(storage: FlowDeps["storage"]): KeptSong[] {
  try {
    const raw = JSON.parse(storage?.getItem(LIST_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return (raw as KeptSong[])
      .filter((s) => s && typeof s.name === "string" && typeof s.url === "string" && typeof s.task === "string" && /^\d{6,24}$/.test(s.task))
      .map((s) => {
        const lines = cleanLines(s.lines);
        return { ...s, ...(s.kind === "prompt" || s.kind === "level" || s.kind === "build" ? {} : { kind: undefined }), verse: Array.isArray(s.verse) ? s.verse.map(String) : [], chorus: Array.isArray(s.chorus) ? s.chorus.map(String) : [], mood: typeof s.mood === "string" ? s.mood : "", ...(lines.length ? { lines } : { lines: undefined }) };
      })
      .slice(0, MAX_KEPT);
  } catch { return []; }
}

/** Reasons the route gives that carry a sentence meant for the child. Anything else it says is never shown. */
const KIND_REASONS = new Set(["idea_not_allowed", "week_used", "songs_off", "budget_spent", "in_progress"]);

export interface ThemeSongFlow {
  /** One free GET: is the route on? Remembered for the life of the flow. */
  isOn(): Promise<boolean>;
  /** The same free GET, with what this device has left this week. `fresh` asks again (the quota changes with every song). Never throws. */
  probe(fresh?: boolean): Promise<{ enabled: boolean; quota: SongQuota | null }>;
  /** Wake our own song-writing model before a song is asked for (it scales to zero when idle). Fire and forget; at most once every three minutes; only when the route is on; never throws. */
  warm(): Promise<void>;
  /** Is a song worth OFFERING now: the route is on, a grown-up has not switched songs off, and a song is left this week. Asks fresh. */
  canMake(): Promise<boolean>;
  /** Name the adventure and start its song. Resolves true once the NAME is in (not the song). Never throws. */
  start(description: string, kind?: FlowKind): Promise<boolean>;
  /** The party ended (the page tells the flow, which owns the card's words). */
  partyEnded(reason: string): void;
  /** Dance again to the song just made (the cut is kept in memory). */
  again(): Promise<boolean>;
  /** Dance to a song kept in this browser (the Songs sheet's list): its audio is fetched again through the route's relay, measured and cut, then the party starts. */
  playKept(song: KeptSong): Promise<boolean>;
  /** Hold the party where it is (the song and the dance wait), and carry on from the same spot. False when there is nothing to hold / nothing held. */
  pause(): boolean;
  resume(): boolean;
  /** Ask again for the same thing with NEW words: a fresh song (a new slot of the week, a new key), the one being made is let go. False when there is nothing to ask again. */
  redo(): Promise<boolean>;
  /** Stop everything and clear the card. */
  cancel(): void;
  state(): FlowState;
}

export function createThemeSongFlow(deps: FlowDeps): ThemeSongFlow {
  const url = deps.url ?? "/api/theme-song";
  const pollMs = deps.pollMs ?? POLL_MS;
  const maxWaitMs = deps.maxWaitMs ?? MAX_WAIT_MS;
  const now = deps.now ?? (() => Date.now());
  const setT = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number);
  const clearT = deps.clearTimeout ?? ((id) => globalThis.clearTimeout(id));
  const hdr = () => { try { return deps.headers?.() ?? {}; } catch { return {}; } };
  const newKey = deps.newKey ?? (() => (globalThis.crypto && "randomUUID" in globalThis.crypto ? globalThis.crypto.randomUUID() : `tap-${now()}-${Math.floor(Math.random() * 1e9)}`));
  const get = (u: string) => deps.fetchImpl(u, { headers: hdr() });
  let st: FlowState = { ...EMPTY };
  let run = 0;
  let timer: number | null = null;
  let available: boolean | null = null;
  let lastQuota: SongQuota | null = null;
  let cut: { entry: unknown; wav: ArrayBuffer; title: string } | null = null;
  let moodOf = ""; // the mood card the song writer chose for this song
  let lastAsk: { description: string; kind: FlowKind } | null = null; // what the child asked for, so "new words" can ask again
  let pausedNote = ""; // the line the card showed before a pause, put back on play

  const set = (patch: Partial<FlowState>) => { st = { ...st, ...patch }; deps.onState(st); };
  const clearTimer = () => { if (timer !== null) { clearT(timer); timer = null; } };
  const sleep = (ms: number) => new Promise<void>((res) => { timer = setT(() => { timer = null; res(); }, ms); });

  const quotaFrom = (v: unknown): SongQuota | null => {
    const q = v as Partial<SongQuota> | null | undefined;
    return q && Number.isInteger(q.left) && Number.isInteger(q.limit) && Number.isInteger(q.used) && typeof q.resetsOn === "string" && typeof q.makerOn === "boolean" ? { limit: q.limit!, used: q.used!, left: q.left!, resetsOn: q.resetsOn, makerOn: q.makerOn } : null;
  };

  async function probe(fresh = false): Promise<{ enabled: boolean; quota: SongQuota | null }> {
    if (!fresh && available !== null) return { enabled: available, quota: lastQuota };
    try {
      const res = await get(url);
      const body = res.ok ? ((await res.json()) as { enabled?: unknown; quota?: unknown }) : null;
      available = body?.enabled === true;
      lastQuota = available ? quotaFrom(body?.quota) : null;
    } catch { available = false; lastQuota = null; }
    return { enabled: available, quota: lastQuota };
  }
  async function isOn(): Promise<boolean> { return (await probe()).enabled; }
  let lastWarm = -Infinity;
  async function warm(): Promise<void> {
    try {
      if (!(await probe()).enabled) return;
      const t = now();
      if (t - lastWarm < WARM_CLIENT_MS) return;
      lastWarm = t;
      await deps.fetchImpl(`${url}/warm`, { method: "POST", headers: hdr() });
    } catch { /* a warm-up that fails changes nothing: the song still works, it may just wait */ }
  }
  async function canMake(): Promise<boolean> {
    const p = await probe(true);
    return p.enabled && p.quota?.makerOn !== false && (p.quota?.left ?? 1) > 0;
  }

  async function startParty(mine: number): Promise<boolean> {
    if (!cut) return false;
    const r = await deps.startParty(cut);
    if (mine !== run) return false;
    if (r.ok) { set({ phase: "dancing", paused: false, note: r.dancing === false ? "Your song is playing!" : "Dance party!" }); return true; }
    set({ phase: "ready", note: r.reason ? `The party could not start (${r.reason}).` : "The party could not start." });
    return false;
  }

  /** The song is finished: fetch it, measure it, cut it, dance. */
  async function finish(mine: number, task: string, link: string, keep = true, timed: LyricLine[] = []): Promise<void> {
    set({ phase: "ready", note: keep ? "Your song is ready! Getting the party ready…" : "Getting the party ready…" });
    let bytes: ArrayBuffer;
    try {
      const res = await get(`${url}?id=${encodeURIComponent(task)}&audio=1`);
      if (!res.ok) throw new Error(String(res.status));
      bytes = await res.arrayBuffer();
    } catch {
      if (mine === run) set({ phase: "ready", fallbackUrl: link, note: "Your song is ready, but the party could not get it. You can still play it." });
      return;
    }
    if (mine !== run) return;
    if (keep) keepSong(deps.storage, { name: st.name, verse: st.verse, chorus: st.chorus, mood: moodOf, url: link, task, madeAt: new Date(now()).toISOString(), ...(timed.length ? { lines: timed } : {}), ...(lastAsk ? { kind: lastAsk.kind } : {}) });
    let planned: ReturnType<typeof analyseTheme>;
    let decoded: { channels: ArrayLike<number>[]; sampleRate: number };
    try {
      decoded = await deps.decode(bytes.slice(0));
      planned = analyseTheme(decoded.channels, decoded.sampleRate);
    } catch {
      if (mine === run) set({ phase: "ready", fallbackUrl: link, note: "Your song is ready! It can't be danced to, but you can play it." });
      return;
    }
    if (mine !== run) return;
    if (!planned.ok) { set({ phase: "ready", fallbackUrl: link, note: "Your song is ready! It has no steady beat to dance to, but you can play it." }); return; }
    cut = {
      entry: themeIndexEntry({ task, name: st.name, mood: moodOf }, planned.cut, bytes.byteLength),
      wav: cutToWav(decoded.channels, decoded.sampleRate, planned.cut),
      title: st.name,
    };
    // the provider's times, moved onto the cut the party loops (nothing guessed: no times, no karaoke)
    set({ karaoke: lyricsForCut(timed, planned.cut.startSec, planned.cut.lengthSec), loop: planned.cut.lengthSec });
    if (deps.holdParty?.()) { set({ phase: "ready", note: "Your song is ready!" }); return; } // kept in memory: `again()` starts the party
    await startParty(mine);
  }

  async function poll(mine: number, task: string, startedAt: number): Promise<void> {
    let fails = 0;
    for (;;) {
      await sleep(pollMs);
      if (mine !== run) return;
      let answer = null as { status?: unknown; url?: unknown; lines?: unknown } | null;
      try {
        const res = await get(`${url}?id=${encodeURIComponent(task)}`);
        if (res.status === 429) continue; // told to slow down: one more turn, not a failure
        if (!res.ok) throw new Error(String(res.status));
        answer = (await res.json()) as typeof answer;
      } catch {
        if (mine !== run) return;
        if (++fails >= MAX_POLL_FAILS) { set({ phase: "failed", note: "The song could not be finished this time. The name and the words are still yours." }); return; }
        continue;
      }
      if (mine !== run) return;
      fails = 0;
      if (answer?.status === "ready" && typeof answer.url === "string") { await finish(mine, task, answer.url, true, cleanLines(answer.lines)); return; }
      if (answer?.status === "failed") { set({ phase: "failed", note: "The song could not be finished this time. The name and the words are still yours." }); return; }
      if (now() - startedAt > maxWaitMs) { set({ phase: "failed", note: "The song is taking too long. The name and the words are still yours." }); return; }
    }
  }

  return {
    isOn,
    probe,
    warm,
    canMake,
    async start(description, kind = "level") {
      const asked = String(description ?? "").trim().slice(0, MAX_DESCRIPTION);
      if (asked) lastAsk = { description: asked, kind };
      const mine = ++run;
      clearTimer();
      cut = null;
      moodOf = "";
      st = { ...EMPTY };
      const text = String(description ?? "").trim().slice(0, MAX_DESCRIPTION);
      if (!text) { deps.onState(st); return false; }
      if (!(await isOn()) || mine !== run) { if (mine === run) deps.onState(st); return false; }
      set({ phase: "writing", note: "Thinking of a name…" });
      let body: Record<string, unknown>;
      try {
        const res = await deps.fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...hdr() }, body: JSON.stringify({ description: text, kind, key: newKey() }) });
        if (!res.ok) {
          // the route turns a request away with a kind sentence of its own: show that one, and nothing else it says
          let why = "";
          let quota: SongQuota | null = null;
          try {
            const j = (await res.json()) as { reason?: unknown; error?: unknown; quota?: unknown };
            if (typeof j?.reason === "string" && KIND_REASONS.has(j.reason) && typeof j.error === "string") why = j.error.slice(0, 80);
            quota = quotaFrom(j?.quota);
          } catch { /* no body */ }
          throw Object.assign(new Error(String(res.status)), { why, quota });
        }
        body = (await res.json()) as Record<string, unknown>;
      } catch (err) {
        const e = err as { why?: string; quota?: SongQuota | null };
        if (e?.quota) lastQuota = e.quota;
        if (mine === run) set({ phase: "failed", note: e?.why || "No song this time. Try again later!", quota: e?.quota ?? st.quota });
        return false;
      }
      if (mine !== run) return false;
      if (quotaFrom(body.quota)) { lastQuota = quotaFrom(body.quota); set({ quota: lastQuota }); }
      if (typeof body.name !== "string" || !Array.isArray(body.verse) || !Array.isArray(body.chorus)) { set({ phase: "failed", note: "No song this time. Try again later!" }); return false; }
      moodOf = typeof body.mood === "string" ? body.mood : "";
      set({ name: body.name, verse: body.verse.map(String), chorus: body.chorus.map(String) });
      const task = typeof body.task === "string" && /^\d{6,24}$/.test(body.task) ? body.task : "";
      if (!task) { set({ phase: "failed", note: typeof body.songError === "string" ? `${body.songError} The name and the words are still yours.` : "No song this time. The name and the words are still yours." }); return true; }
      set({ phase: "making", note: "Singing your song. This takes about a minute!" });
      void poll(mine, task, now());
      return true;
    },
    partyEnded(reason) {
      if (st.phase !== "dancing") return;
      set({ phase: "over", paused: false, note: reason === "time" ? "That was a great party!" : "Party's over!" });
    },
    pause() {
      if (st.phase !== "dancing" || st.paused) return false;
      if (!deps.pauseParty?.()) return false;
      pausedNote = st.note;
      set({ paused: true, note: "Paused. Tap play to carry on!" });
      return true;
    },
    resume() {
      if (st.phase !== "dancing" || !st.paused) return false;
      if (!deps.resumeParty?.()) return false;
      set({ paused: false, note: pausedNote || "Dance party!" });
      return true;
    },
    async playKept(song) {
      const mine = ++run;
      clearTimer();
      cut = null;
      moodOf = song.mood;
      st = { ...EMPTY };
      if (!/^\d{6,24}$/.test(song.task)) return false;
      set({ phase: "ready", name: song.name, verse: song.verse, chorus: song.chorus, note: "Getting the party ready…" });
      let timed = song.lines ?? [];
      if (!timed.length) {
        // a song kept before the karaoke existed: ask the route once for its times (best effort; none is fine)
        try {
          const res = await get(`${url}?id=${encodeURIComponent(song.task)}`);
          if (res.ok) timed = cleanLines(((await res.json()) as { lines?: unknown }).lines);
        } catch { /* no karaoke for this one */ }
        if (mine !== run) return false;
      }
      await finish(mine, song.task, song.url, false, timed);
      return mine === run && st.phase === "dancing";
    },
    async redo() {
      if (!lastAsk) return false;
      return this.start(lastAsk.description, lastAsk.kind);
    },
    async again() {
      if (!cut || st.phase === "dancing") return false;
      return startParty(run);
    },
    cancel() { run++; clearTimer(); cut = null; st = { ...EMPTY }; deps.onState(st); },
    state: () => st,
  };
}
