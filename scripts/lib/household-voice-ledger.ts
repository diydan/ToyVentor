// The household voice clips and the ledger that tracks them (src/lib/householdVoice.ledger.json, committed). scripts/prewarm-voice.ts asks the live /api/voice route
// for each clip once, so the Worker's edge cache holds it; the ledger records WHICH clips have been made and what text each speaks, so a clip made earlier is
// not asked for again, a changed noun or a new item is, and `--missing` shows what is left. The edge cache is not permanent storage: the ledger is the memory.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOUSEHOLD_IDS, HOUSEHOLD_NAMES, NAME_LANGS, householdName, householdTextHash, type NamesFile, spelledInOtherLanguage } from "../../src/lib/householdNames";
import type { LangCode } from "../../src/lib/propNames";
import { DEFAULT_VOICE, VOICE_MODEL } from "../../worker/voice";

export const LEDGER_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../src/lib/householdVoice.ledger.json");

export interface LedgerClip {
  /** The text the clip speaks. */
  text: string;
  /** householdTextHash(text): a changed noun is a different hash. */
  textHash: string;
  status: "made" | "failed";
  /** For a made clip: its size and the SHA-256 of the audio the route returned. */
  bytes?: number;
  audioSha256?: string;
  model: string;
  voice: string;
  /** The day it was made or last tried (YYYY-MM-DD). */
  date: string;
  /** For a failed clip: why (a status or message, never a response body). */
  error?: string;
}
export interface Ledger { version: 1; clips: Record<string, LedgerClip> }
export interface HouseholdClip { key: string; id: string; lang: LangCode; text: string; textHash: string; path: string }

export const clipKey = (lang: LangCode, id: string) => `${lang}/${id}`;

/**
 * Every clip the game can ask for (an item with a name in a language), how many (item, language) pairs have no name yet and so no clip, and how many are
 * spelled the same in another language and so are never asked of the clip voice (the device voice says them, with an explicit language tag).
 */
export function householdClips(file: NamesFile = HOUSEHOLD_NAMES, ids: readonly string[] = HOUSEHOLD_IDS): { clips: HouseholdClip[]; withoutName: number; deviceOnly: number } {
  const clips: HouseholdClip[] = [];
  let withoutName = 0;
  let deviceOnly = 0;
  for (const lang of NAME_LANGS) for (const id of ids) {
    const text = householdName(id, lang, file);
    if (!text) {
      withoutName++;
      continue;
    }
    if (spelledInOtherLanguage(text, lang, file)) {
      deviceOnly++;
      continue;
    }
    const textHash = householdTextHash(text);
    // the same URL the client asks for (householdVoiceUrl in src/lib/householdVoice.ts): the fingerprint keeps a corrected noun a new request
    clips.push({ key: clipKey(lang, id), id, lang, text, textHash, path: `/api/voice?${new URLSearchParams({ lang, h: id, v: textHash }).toString()}` });
  }
  return { clips, withoutName, deviceOnly };
}

/** A clip is done when the ledger lists it as made for exactly this text. */
export function isMade(clip: HouseholdClip, ledger: Ledger): boolean {
  const e = ledger.clips[clip.key];
  return Boolean(e && e.status === "made" && e.textHash === clip.textHash);
}

/** What a run should ask for: everything (--force), or what the ledger lacks (a new item, a changed noun, a failure). */
export function planClips(clips: readonly HouseholdClip[], ledger: Ledger, o: { force?: boolean } = {}): { todo: HouseholdClip[]; skipped: HouseholdClip[] } {
  const todo: HouseholdClip[] = [];
  const skipped: HouseholdClip[] = [];
  for (const c of clips) (o.force || !isMade(c, ledger) ? todo : skipped).push(c);
  return { todo, skipped };
}

export function missingClips(clips: readonly HouseholdClip[], ledger: Ledger): HouseholdClip[] {
  return clips.filter((c) => !isMade(c, ledger));
}

export function emptyLedger(): Ledger {
  return { version: 1, clips: {} };
}

export function readLedger(path = LEDGER_PATH): Ledger {
  return JSON.parse(readFileSync(path, "utf8")) as Ledger;
}

/** Sorted by key, one clip per line, so a run's diff shows exactly the clips it touched. */
export function serializeLedger(ledger: Ledger): string {
  const q = (v: unknown) => JSON.stringify(v);
  const keys = Object.keys(ledger.clips).sort();
  const lines = ["{", `  "version": ${ledger.version},`, '  "clips": {'];
  keys.forEach((k, i) => {
    const c = ledger.clips[k]!;
    const fields: Array<[string, unknown]> = [["text", c.text], ["textHash", c.textHash], ["status", c.status]];
    if (c.bytes !== undefined) fields.push(["bytes", c.bytes]);
    if (c.audioSha256 !== undefined) fields.push(["audioSha256", c.audioSha256]);
    fields.push(["model", c.model], ["voice", c.voice], ["date", c.date]);
    if (c.error !== undefined) fields.push(["error", c.error]);
    lines.push(`    ${q(k)}: { ${fields.map(([n, v]) => `${q(n)}: ${q(v)}`).join(", ")} }${i < keys.length - 1 ? "," : ""}`);
  });
  lines.push("  }", "}", "");
  return lines.join("\n");
}

export function writeLedger(ledger: Ledger, path = LEDGER_PATH): void {
  writeFileSync(path, serializeLedger(ledger));
}

/** What is wrong with a ledger (empty when sound): known languages and items, the right shape, a hash that matches its text. */
export function validateLedger(ledger: Ledger, ids: readonly string[] = HOUSEHOLD_IDS): string[] {
  const out: string[] = [];
  if (ledger.version !== 1) out.push(`version ${String(ledger.version)} is not 1`);
  for (const [key, c] of Object.entries(ledger.clips)) {
    const [lang, id] = key.split("/");
    if (!NAME_LANGS.includes(lang as LangCode) || !ids.includes(id ?? "")) out.push(`${key}: not a known language and household item`);
    if (c.status !== "made" && c.status !== "failed") out.push(`${key}: status ${String(c.status)}`);
    if (typeof c.text !== "string" || c.textHash !== householdTextHash(c.text)) out.push(`${key}: textHash does not match its text`);
    if (!c.model || !c.voice || !/^\d{4}-\d{2}-\d{2}$/.test(c.date)) out.push(`${key}: model, voice and a YYYY-MM-DD date are required`);
    if (c.status === "made" && !(Number.isInteger(c.bytes) && c.bytes! > 0 && /^[0-9a-f]{64}$/.test(c.audioSha256 ?? ""))) out.push(`${key}: a made clip needs its bytes and the sha256 of its audio`);
    if (c.status === "failed" && !c.error) out.push(`${key}: a failed clip needs a reason`);
  }
  return out;
}

export interface WarmStats { made: number; alreadyCached: number; failed: number; skipped: number; bytes: number }

/**
 * Ask the live route for each clip the ledger lacks (or every clip with `force`), record every outcome in the ledger, and return the new ledger. A clip is
 * `made` only when the route answers 200 with audio; any other outcome is `failed` with a status or message (never a body) and is asked for again next time.
 * `fetchImpl` and `now` are injectable so the tests never touch the network.
 */
export async function warmHousehold(o: {
  base: string;
  clips: readonly HouseholdClip[];
  ledger: Ledger;
  fetchImpl?: typeof fetch;
  force?: boolean;
  concurrency?: number;
  now?: () => Date;
}): Promise<{ ledger: Ledger; stats: WarmStats; failures: string[] }> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const today = (o.now?.() ?? new Date()).toISOString().slice(0, 10);
  const { todo, skipped } = planClips(o.clips, o.ledger, { force: o.force });
  const next: Ledger = { version: 1, clips: { ...o.ledger.clips } };
  const stats: WarmStats = { made: 0, alreadyCached: 0, failed: 0, skipped: skipped.length, bytes: 0 };
  const failures: string[] = [];
  let at = 0;
  const failedEntry = (c: HouseholdClip, error: string): LedgerClip => ({ text: c.text, textHash: c.textHash, status: "failed", model: VOICE_MODEL, voice: DEFAULT_VOICE, date: today, error });
  async function worker() {
    while (at < todo.length) {
      const c = todo[at++]!;
      try {
        const res = await fetchImpl(new URL(c.path, o.base).toString());
        if (!res.ok) {
          stats.failed++;
          failures.push(`${res.status} ${c.path}`);
          next.clips[c.key] = failedEntry(c, `HTTP ${res.status}`);
          continue;
        }
        const audio = new Uint8Array(await res.arrayBuffer());
        if (audio.length === 0) {
          stats.failed++;
          failures.push(`empty ${c.path}`);
          next.clips[c.key] = failedEntry(c, "empty audio");
          continue;
        }
        stats.bytes += audio.length;
        if (res.headers.get("x-voice-cache") === "hit") stats.alreadyCached++;
        else stats.made++;
        next.clips[c.key] = {
          text: c.text, textHash: c.textHash, status: "made", bytes: audio.length, audioSha256: createHash("sha256").update(audio).digest("hex"),
          model: VOICE_MODEL, voice: res.headers.get("x-voice-voice") || DEFAULT_VOICE, date: today,
        };
      } catch (e) {
        stats.failed++;
        failures.push(`${(e as Error).message} ${c.path}`);
        next.clips[c.key] = failedEntry(c, (e as Error).message.slice(0, 120));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 4) }, worker));
  return { ledger: next, stats, failures };
}
