// The title page's music (src/features/game/world/titleMusicCore.ts; Dan, 2026-11-04 night: "temporary default music until the custom theme song lands", then "show a proper karaoke
// text to match the lyrics"). Pure picks, and the controller driven with a fake audio element and fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { karaokeAt } from "../shared/songKaraoke";
import { WATERMARK_TAIL_S } from "../shared/themeParty";
import type { KeptSong } from "../src/features/game/world/themeSongFlow";
import {
  CROSSFADE_S, DEFAULT_TITLE_TRACK, FADE_IN_S, MIN_LOOP_S, MUTE_KEY, WATERMARK_MIN_TAIL_S, TITLE_VOLUME, createTitleMusic, karaokeFor, loopSecondsFor, pickTitleSong, readMuted, writeMuted,
  type AudioLike, type TitleMusic,
} from "../src/features/game/world/titleMusicCore";

const kept = (over: Partial<KeptSong> & { task: string }): KeptSong => ({ name: "Mia's song", verse: [], chorus: [], mood: "bouncy", url: "https://x/y.mp3", madeAt: "2026-11-04T10:00:00Z", ...over });

describe("which song the title plays", () => {
  it("is the newest song made for the player's own theme, not a level or Build song", () => {
    const list = [kept({ task: "100000001", kind: "level" }), kept({ task: "100000002", kind: "prompt", name: "new" }), kept({ task: "100000003", kind: "prompt", name: "old" }), kept({ task: "100000004" })];
    expect(pickTitleSong(list)?.name).toBe("new");
    expect(pickTitleSong([kept({ task: "100000001", kind: "build" }), kept({ task: "100000005", kind: "level" })])).toBeNull();
    expect(pickTitleSong([])).toBeNull();
  });
  it("falls back to the newest song kept before kinds were recorded when no song is tagged, but a tagged one always wins", () => {
    expect(pickTitleSong([kept({ task: "100000001", kind: "level" }), kept({ task: "100000009", name: "legacy new" }), kept({ task: "100000008", name: "legacy old" })])?.name).toBe("legacy new");
    expect(pickTitleSong([kept({ task: "100000009", name: "legacy" }), kept({ task: "100000002", kind: "prompt", name: "tagged" })])?.name).toBe("tagged");
  });
  it("ignores a task that is not a provider id", () => {
    expect(pickTitleSong([kept({ task: "../etc", kind: "prompt" })])).toBeNull();
  });
  it("the default track is a starter song that ships with the app", () => {
    expect(existsSync(resolve(__dirname, "..", "public", DEFAULT_TITLE_TRACK.url.replace(/^\//, "")))).toBe(true);
  });
});

describe("the loop and the karaoke", () => {
  it("loops everything before the provider's watermark, and nothing too short", () => {
    expect(loopSecondsFor(60)).toBeCloseTo(60 - WATERMARK_TAIL_S, 9);
    expect(loopSecondsFor(MIN_LOOP_S + WATERMARK_TAIL_S)).toBe(MIN_LOOP_S);
    expect(loopSecondsFor(MIN_LOOP_S + WATERMARK_TAIL_S - 0.1)).toBe(0);
    expect(loopSecondsFor(NaN)).toBe(0);
    expect(loopSecondsFor(0)).toBe(0);
  });
  it("with timed lines the loop ends just inside the last sung line, never before the cautious cut and never into the watermark (the first real song: 65.19 s, last line ends 60.52 s)", () => {
    expect(loopSecondsFor(65.19, [{ e: 30400 }, { e: 60520 }])).toBeCloseTo(60.42, 6);
    expect(loopSecondsFor(65.19, [{ e: 52000 }])).toBeCloseTo(65.19 - WATERMARK_TAIL_S, 6);              // an outro after the last line: the cautious cut
    expect(loopSecondsFor(65.19, [{ e: 64000 }])).toBeCloseTo(65.19 - WATERMARK_MIN_TAIL_S, 6);           // lines that run late: never into the watermark
    expect(loopSecondsFor(65.19, [])).toBeCloseTo(65.19 - WATERMARK_TAIL_S, 6);
    expect(loopSecondsFor(65.19, [{ e: NaN }])).toBeCloseTo(65.19 - WATERMARK_TAIL_S, 6);
    expect(loopSecondsFor(12, [{ e: 9000 }])).toBe(0);                                                    // still too short to loop
  });
  it("puts the provider's timed lines on the loop; a song with none has no karaoke (no guessing)", () => {
    const song = kept({ task: "100000002", kind: "prompt", lines: [{ s: 2000, e: 5000, t: "Hello Mia", w: [2000, 3500] }, { s: 6000, e: 8000, t: "Sing along" }, { s: 59000, e: 61000, t: "after the cut" }] });
    const lines = karaokeFor(song, 50);
    expect(lines.map((l) => l.text)).toEqual(["Hello Mia", "Sing along"]);
    expect(karaokeAt(lines, 2.5, 50).line?.text).toBe("Hello Mia");
    expect(karaokeFor(kept({ task: "100000002" }), 50)).toEqual([]);
    expect(karaokeFor(song, 0)).toEqual([]);
  });
  it("remembers a mute", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(readMuted(s)).toBe(false);
    writeMuted(s, true);
    expect(m.get(MUTE_KEY)).toBe("1");
    expect(readMuted(s)).toBe(true);
    expect(readMuted(null)).toBe(false);
  });
});

class FakeAudio implements AudioLike {
  volume = 1; loop = false; currentTime = 0; duration = NaN; paused = true; playCalls = 0; rejectPlay = false;
  private ls: Record<string, (() => void)[]> = {};
  constructor(public src: string) {}
  load() { this.ls.__load?.forEach((f) => f()); }
  play() { this.playCalls++; if (this.rejectPlay) return Promise.reject(new Error("NotAllowedError")); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener(type: string, fn: () => void) { (this.ls[type] ??= []).push(fn); }
  fire(type: string) { (this.ls[type] ?? []).forEach((f) => f()); }
}

describe("the controller", () => {
  let made: FakeAudio[];
  let revoked: string[];
  let blob: Blob | null;
  let songSeconds: number;
  let ctl: TitleMusic;
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const make = () => createTitleMusic({
    makeAudio: (src) => { const a = new FakeAudio(src); if (src.startsWith("blob:")) { a.duration = NaN; (a as unknown as { load: () => void }).load = () => { a.duration = songSeconds; a.fire("loadedmetadata"); }; } else a.duration = 44; made.push(a); return a; },
    fetchSongAudio: async () => blob,
    objectUrl: () => "blob:song-1",
    revokeUrl: (u) => void revoked.push(u),
    storage,
  });
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  beforeEach(() => { vi.useFakeTimers(); made = []; revoked = []; blob = new Blob(["x"]); songSeconds = 60; store.clear(); ctl = make(); });
  afterEach(() => { ctl.stop(); vi.useRealTimers(); });
  const settle = async (s = 2) => { vi.advanceTimersByTime(s * 1000); await flush(); };

  it("makes no sound until a tap, then fades the default song in", async () => {
    expect(made).toHaveLength(0);
    expect(ctl.state()).toMatchObject({ armed: false, playing: false });
    ctl.arm();
    expect(made).toHaveLength(1);
    expect(made[0]!.src).toBe(DEFAULT_TITLE_TRACK.url);
    expect(made[0]!.loop).toBe(true);
    expect(made[0]!.volume).toBe(0);
    await settle(FADE_IN_S + 0.3);
    expect(made[0]!.volume).toBeCloseTo(TITLE_VOLUME, 5);
    expect(ctl.state()).toMatchObject({ armed: true, playing: true });
    expect(ctl.state().track.kind).toBe("default");
  });

  it("a muted device stays silent after the tap, and unmuting starts the song", async () => {
    ctl.setMuted(true);
    ctl.arm();
    await settle();
    expect(made[0]?.paused ?? true).toBe(true);
    expect(store.get(MUTE_KEY)).toBe("1");
    ctl.setMuted(false);
    await settle(FADE_IN_S + 0.3);
    expect(ctl.state().playing).toBe(true);
    expect(make().state().muted).toBe(false);
  });

  it("waits while another sound has the stage (hold) and carries on after", async () => {
    ctl.arm();
    await settle(1.5);
    ctl.setHold(true);
    await settle(1);
    expect(made[0]!.paused).toBe(true);
    expect(ctl.state()).toMatchObject({ held: true, playing: false });
    ctl.setHold(false);
    await settle(1.5);
    expect(made[0]!.paused).toBe(false);
    expect(made[0]!.volume).toBeCloseTo(TITLE_VOLUME, 5);
  });

  it("a browser that refuses to play leaves the next tap able to try again", async () => {
    const first = createTitleMusic({ makeAudio: (src) => { const a = new FakeAudio(src); a.rejectPlay = true; made.push(a); return a; }, fetchSongAudio: async () => null, objectUrl: () => "", revokeUrl: () => {} });
    first.arm();
    await flush();
    expect(first.state().armed).toBe(false);
    first.stop();
  });

  it("crossfades to the player's own song when it lands, loops it before the watermark, and shows its karaoke", async () => {
    ctl.arm();
    await settle(1.5);
    const song = kept({ task: "100000002", kind: "prompt", name: "Mia's song", lines: [{ s: 1000, e: 4000, t: "Hello Mia", w: [1000, 2500] }] });
    ctl.setSong(song);
    await settle(0.1);
    const custom = made.find((a) => a.src.startsWith("blob:"))!;
    expect(custom).toBeDefined();
    await settle(CROSSFADE_S + 0.5);
    expect(custom.paused).toBe(false);
    expect(custom.volume).toBeCloseTo(TITLE_VOLUME, 5);
    expect(made[0]!.paused).toBe(true); // the default was faded out and let go
    const st = ctl.state();
    expect(st.track).toMatchObject({ kind: "custom", title: "Mia's song" });
    expect(st.track.loop).toBeCloseTo(60 - WATERMARK_TAIL_S, 6);
    expect(st.track.karaoke.map((l) => l.text)).toEqual(["Hello Mia"]);
    custom.currentTime = 2;
    expect(ctl.playhead()).toBe(2);
    custom.currentTime = st.track.loop - 0.01;
    await settle(0.1);
    expect(custom.currentTime).toBe(0);
  });

  it("keeps the default when the song cannot be had, is too short, or was asked for and then replaced", async () => {
    ctl.arm();
    await settle(1.5);
    blob = null;
    ctl.setSong(kept({ task: "100000002", kind: "prompt" }));
    await settle(2);
    expect(ctl.state().track.kind).toBe("default");
    expect(made.filter((a) => a.src.startsWith("blob:"))).toHaveLength(0);
    blob = new Blob(["x"]);
    songSeconds = 9; // 3.5 s once the watermark is cut off
    ctl.setSong(kept({ task: "100000003", kind: "prompt" }));
    await settle(2);
    expect(ctl.state().track.kind).toBe("default");
    expect(revoked).toContain("blob:song-1");
    expect(made[0]!.paused).toBe(false);
  });

  it("goes back to the default if the song is taken away, and stop() lets everything go", async () => {
    ctl.arm();
    await settle(1.5);
    ctl.setSong(kept({ task: "100000002", kind: "prompt" }));
    await settle(CROSSFADE_S + 1);
    expect(ctl.state().track.kind).toBe("custom");
    ctl.setSong(null);
    await settle(CROSSFADE_S + 1);
    expect(ctl.state().track.kind).toBe("default");
    expect(ctl.state().playing).toBe(true);
    ctl.stop();
    vi.advanceTimersByTime(2000);
    for (const a of made) expect(a.paused).toBe(true);
    expect(revoked).toContain("blob:song-1");
  });
});

describe("the title page wiring (text pins)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const read = (rel: string) => require("node:fs").readFileSync(resolve(__dirname, "..", rel), "utf8") as string;
  const menu = read("src/features/game/world/TitleMenu.tsx");
  const comp = read("src/features/game/world/TitleMusic.tsx");
  it("the title draws the music block outside its header (the header's entrance animation would become the box the speaker button is placed against)", () => {
    const head = menu.slice(menu.indexOf("<header"), menu.indexOf("</header>"));
    expect(head).not.toContain("TitleMusic");
    expect(menu).toContain("<TitleMusic songKey={songKey} hold={musicHold} />");
  });
  it("sound starts only from a tap, key or click (and not from the speaker button itself); the music is let go when the title closes", () => {
    for (const ev of ["pointerup", "touchend", "click", "keydown"]) expect(comp).toContain(`"${ev}"`);
    expect(comp).toContain("[data-title-music-toggle]");
    expect(comp).toMatch(/return \(\) => \{[\s\S]{0,300}c\.stop\(\)/);
  });
  it("the karaoke is the song card's own component, fed the provider's timed lines on the title's loop", () => {
    expect(comp).toContain('import { Karaoke } from "./ThemeSongCard"');
    expect(comp).toContain("lines={st.track.karaoke} loop={st.track.loop} playhead={playhead}");
  });
});
