// The dances the game's character can do at a party (docs/specs/dance-party-spec.md 5.1; Dan, 2026-11-03: "dance variety").
//
// The Samba is built in (the character's own bank). The others are the baked Mixamo dances the Kip bench already ships (public/kip/mixamo/baked/): an index lists them with the tempo
// and the beats someone counted, and each dance is fetched, CHECKED and converted (runtime/bakedDance.ts) the first time a party needs it, then kept. A dance with no counted tempo
// (the Chicken, the Locking) is not offered: it cannot be put on a beat. Nothing here is trusted: the index and every file are checked field by field, and a dance that does not
// pass is simply not offered, so a party with a broken file is a party with fewer dances, never a broken one.
import type { PartyClip } from "../../../../../shared/songParty";
import { beatHit, jointClipToGame, parseJointClip } from "./bakedDance";
import type { BakedClip } from "./mixamo";

export interface GameDance extends PartyClip {
  id: string;
  bpm: number;
  beats: number;
  group: "dance";
  label: string;
  /** Seconds into the clip where the dancer's weight lands: put ON the song's beat. 0 until the dance is loaded (or when its hips keep no steady beat). */
  hit: number;
  /** In the character's bank and playable now. */
  loaded: boolean;
}

/** The Samba, counted: eight beats in its 4.4 s loop (109.09 bpm), the weight landing 0.21 s in (tests/game-party.test.ts re-measures it from the real clip). */
export const SAMBA: GameDance = { id: "dance", bpm: 109.09, beats: 8, group: "dance", label: "Samba", hit: 0.21, loaded: true };

const ID = /^[a-z0-9_]{1,40}$/;
const MAX_FILE_CHARS = 900_000;
const MAX_INDEX_CHARS = 100_000;
const MAX_LABEL = 40;

/** The dances an index offers: `dance` group only, a tempo someone counted (40 to 220 bpm) and a whole number of beats, a plain id. Anything else is left out. */
export function parseDanceIndex(raw: unknown): GameDance[] {
  const list = typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw as { v?: unknown }).v === 1 ? (raw as { clips?: unknown }).clips : null;
  if (!Array.isArray(list)) return [];
  const out: GameDance[] = [];
  const seen = new Set<string>([SAMBA.id]);
  for (const item of list) {
    const c = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof c.id !== "string" || !ID.test(c.id) || seen.has(c.id) || c.group !== "dance") continue;
    if (typeof c.bpm !== "number" || !Number.isFinite(c.bpm) || c.bpm < 40 || c.bpm > 220) continue;
    if (typeof c.beats !== "number" || !Number.isInteger(c.beats) || c.beats < 1 || c.beats > 400) continue;
    seen.add(c.id);
    out.push({ id: c.id, bpm: c.bpm, beats: c.beats, group: "dance", label: typeof c.label === "string" && c.label.length > 0 ? c.label.slice(0, MAX_LABEL) : c.id, hit: 0, loaded: false });
  }
  return out;
}

export interface DanceLibraryDeps {
  fetchImpl: typeof fetch;
  /** Put converted clips into the character's bank. */
  addClips(clips: Record<string, BakedClip>): void;
  /** Where the baked files are (default /kip/mixamo/baked/). */
  base?: string;
}

export interface DanceLibrary {
  /** Read the index once (free, 3 KB). A failure leaves the Samba alone. Safe to call again. */
  prepare(): Promise<void>;
  /** Every dance known now, the Samba first, loaded or not. */
  list(): GameDance[];
  /** Fetch, check and convert these dances (those not already loaded). Resolves the ids that are playable now, in the order asked; one that fails is left out. */
  ensure(ids: readonly string[]): Promise<string[]>;
}

export function createDanceLibrary(deps: DanceLibraryDeps): DanceLibrary {
  const base = (deps.base ?? "/kip/mixamo/baked/").replace(/\/*$/, "/");
  const entries = new Map<string, GameDance>([[SAMBA.id, { ...SAMBA }]]);
  let preparing: Promise<void> | null = null;
  const loading = new Map<string, Promise<boolean>>();

  async function readText(url: string, cap: number): Promise<string | null> {
    try {
      const res = await deps.fetchImpl(url);
      if (!res.ok) return null;
      const text = await res.text();
      return text.length > cap ? null : text;
    } catch { return null; }
  }

  async function prepare(): Promise<void> {
    preparing ??= (async () => {
      const text = await readText(`${base}index.json`, MAX_INDEX_CHARS);
      if (!text) return;
      try { for (const d of parseDanceIndex(JSON.parse(text))) entries.set(d.id, d); } catch { /* not JSON: the Samba alone */ }
    })();
    await preparing;
  }

  function load(id: string): Promise<boolean> {
    const have = entries.get(id);
    if (!have) return Promise.resolve(false);
    if (have.loaded) return Promise.resolve(true);
    let p = loading.get(id);
    if (!p) {
      p = (async () => {
        const text = await readText(`${base}${id}.json`, MAX_FILE_CHARS);
        if (!text) return false;
        let raw: unknown;
        try { raw = JSON.parse(text); } catch { return false; }
        const joint = parseJointClip(raw);
        // the file must be the dance the index says, at the tempo and the beat count the index says: a mismatch is a different file
        if (!joint || joint.id !== id || joint.group !== "dance") return false;
        if (joint.bpm !== undefined && Math.abs(joint.bpm - have.bpm) > 0.01) return false;
        if (joint.beats !== undefined && joint.beats !== have.beats) return false;
        const clip = jointClipToGame(joint, id);
        deps.addClips({ [id]: clip });
        have.hit = beatHit(clip, have.beats).offset;
        have.loaded = true;
        return true;
      })().finally(() => loading.delete(id));
      loading.set(id, p);
    }
    return p;
  }

  return {
    prepare,
    list: () => [...entries.values()],
    async ensure(ids) {
      await prepare();
      const results = await Promise.all(ids.map(async (id) => [id, await load(id)] as const));
      return results.filter(([, ok]) => ok).map(([id]) => id);
    },
  };
}
