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

export type FlowPhase = "idle" | "writing" | "making" | "ready" | "dancing" | "over" | "failed";
export type FlowKind = "build" | "level" | "prompt";

export interface FlowState {
  phase: FlowPhase;
  name: string;
  verse: string[];
  chorus: string[];
  /** One kind sentence for the child. */
  note: string;
  /** A plain link to the finished song, set when it could not be cut to dance to. */
  fallbackUrl: string;
}

export interface FlowDeps {
  fetchImpl: typeof fetch;
  /** Decode an audio file's bytes (the browser's own decoder). */
  decode(bytes: ArrayBuffer): Promise<{ channels: ArrayLike<number>[]; sampleRate: number }>;
  /** Start the party with the checked entry and the WAV cut; resolves how it went. */
  startParty(song: { entry: unknown; wav: ArrayBuffer; title: string }): Promise<{ ok: boolean; dancing?: boolean; reason?: string }>;
  onState(state: FlowState): void;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
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

const EMPTY: FlowState = { phase: "idle", name: "", verse: [], chorus: [], note: "", fallbackUrl: "" };

export interface KeptSong {
  name: string;
  verse: string[];
  chorus: string[];
  mood: string;
  url: string;
  task: string;
  madeAt: string;
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
      .map((s) => ({ ...s, verse: Array.isArray(s.verse) ? s.verse.map(String) : [], chorus: Array.isArray(s.chorus) ? s.chorus.map(String) : [], mood: typeof s.mood === "string" ? s.mood : "" }))
      .slice(0, MAX_KEPT);
  } catch { return []; }
}

export interface ThemeSongFlow {
  /** One free GET: is the route on? Remembered for the life of the flow. */
  isOn(): Promise<boolean>;
  /** Name the adventure and start its song. Resolves true once the NAME is in (not the song). Never throws. */
  start(description: string, kind?: FlowKind): Promise<boolean>;
  /** The party ended (the page tells the flow, which owns the card's words). */
  partyEnded(reason: string): void;
  /** Dance again to the song just made (the cut is kept in memory). */
  again(): Promise<boolean>;
  /** Dance to a song kept in this browser (the Songs sheet's list): its audio is fetched again through the route's relay, measured and cut, then the party starts. */
  playKept(song: KeptSong): Promise<boolean>;
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
  let st: FlowState = { ...EMPTY };
  let run = 0;
  let timer: number | null = null;
  let available: boolean | null = null;
  let cut: { entry: unknown; wav: ArrayBuffer; title: string } | null = null;
  let moodOf = ""; // the mood card the song writer chose for this song

  const set = (patch: Partial<FlowState>) => { st = { ...st, ...patch }; deps.onState(st); };
  const clearTimer = () => { if (timer !== null) { clearT(timer); timer = null; } };
  const sleep = (ms: number) => new Promise<void>((res) => { timer = setT(() => { timer = null; res(); }, ms); });

  async function isOn(): Promise<boolean> {
    if (available !== null) return available;
    try {
      const res = await deps.fetchImpl(url);
      available = res.ok && ((await res.json()) as { enabled?: unknown })?.enabled === true;
    } catch { available = false; }
    return available;
  }

  async function startParty(mine: number): Promise<boolean> {
    if (!cut) return false;
    const r = await deps.startParty(cut);
    if (mine !== run) return false;
    if (r.ok) { set({ phase: "dancing", note: r.dancing === false ? "Your song is playing!" : "Dance party!" }); return true; }
    set({ phase: "ready", note: r.reason ? `The party could not start (${r.reason}).` : "The party could not start." });
    return false;
  }

  /** The song is finished: fetch it, measure it, cut it, dance. */
  async function finish(mine: number, task: string, link: string, keep = true): Promise<void> {
    set({ phase: "ready", note: keep ? "Your song is ready! Getting the party ready…" : "Getting the party ready…" });
    let bytes: ArrayBuffer;
    try {
      const res = await deps.fetchImpl(`${url}?id=${encodeURIComponent(task)}&audio=1`);
      if (!res.ok) throw new Error(String(res.status));
      bytes = await res.arrayBuffer();
    } catch {
      if (mine === run) set({ phase: "ready", fallbackUrl: link, note: "Your song is ready, but the party could not get it. You can still play it." });
      return;
    }
    if (mine !== run) return;
    if (keep) keepSong(deps.storage, { name: st.name, verse: st.verse, chorus: st.chorus, mood: moodOf, url: link, task, madeAt: new Date(now()).toISOString() });
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
    await startParty(mine);
  }

  async function poll(mine: number, task: string, startedAt: number): Promise<void> {
    let fails = 0;
    for (;;) {
      await sleep(pollMs);
      if (mine !== run) return;
      let answer = null as { status?: unknown; url?: unknown } | null;
      try {
        const res = await deps.fetchImpl(`${url}?id=${encodeURIComponent(task)}`);
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
      if (answer?.status === "ready" && typeof answer.url === "string") { await finish(mine, task, answer.url); return; }
      if (answer?.status === "failed") { set({ phase: "failed", note: "The song could not be finished this time. The name and the words are still yours." }); return; }
      if (now() - startedAt > maxWaitMs) { set({ phase: "failed", note: "The song is taking too long. The name and the words are still yours." }); return; }
    }
  }

  return {
    isOn,
    async start(description, kind = "level") {
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
        const res = await deps.fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: text, kind }) });
        if (!res.ok) {
          // the route turns an idea it will not use away with a kind sentence of its own: show that one, and nothing else it says
          let why = "";
          try { const j = (await res.json()) as { reason?: unknown; error?: unknown }; if (j?.reason === "idea_not_allowed" && typeof j.error === "string") why = j.error.slice(0, 80); } catch { /* no body */ }
          throw Object.assign(new Error(String(res.status)), { why });
        }
        body = (await res.json()) as Record<string, unknown>;
      } catch (err) {
        if (mine === run) set({ phase: "failed", note: (err as { why?: string })?.why || "No song this time. Try again later!" });
        return false;
      }
      if (mine !== run) return false;
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
      set({ phase: "over", note: reason === "time" ? "That was a great party!" : "Party's over!" });
    },
    async playKept(song) {
      const mine = ++run;
      clearTimer();
      cut = null;
      moodOf = song.mood;
      st = { ...EMPTY };
      if (!/^\d{6,24}$/.test(song.task)) return false;
      set({ phase: "ready", name: song.name, verse: song.verse, chorus: song.chorus, note: "Getting the party ready…" });
      await finish(mine, song.task, song.url, false);
      return mine === run && st.phase === "dancing";
    },
    async again() {
      if (!cut || st.phase === "dancing") return false;
      return startParty(run);
    },
    cancel() { run++; clearTimer(); cut = null; st = { ...EMPTY }; deps.onState(st); },
    state: () => st,
  };
}
