// The kept-songs list holds 20, newest first, but never loses the newest welcome song (kind "prompt"): at ten songs a day it would be gone in two days (Dan: the welcome song is kept in My songs).
import { describe, expect, it } from "vitest";
import { capKept, keepSong, readKeptSongs, type KeptSong } from "../src/features/game/world/themeSongFlow";

const song = (n: number, kind?: KeptSong["kind"]): KeptSong => ({ name: `Song ${n}`, verse: ["a"], chorus: ["b"], mood: "happy", url: `/s/${n}.mp3`, task: String(100000 + n), madeAt: "2026-11-05T00:00:00Z", ...(kind ? { kind } : {}) });
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe("capKept", () => {
  it("leaves a short list alone and cuts a long one to the newest 20", () => {
    const short = [song(1), song(2)];
    expect(capKept(short)).toBe(short);
    const long = Array.from({ length: 30 }, (_, i) => song(30 - i)); // newest first
    expect(capKept(long).map((s) => s.name)).toEqual(long.slice(0, 20).map((s) => s.name));
  });
  it("keeps the welcome song when it would have fallen off, in the last place, and drops the oldest other song instead", () => {
    const list = [...Array.from({ length: 24 }, (_, i) => song(30 - i)), song(1, "prompt")];
    const kept = capKept(list);
    expect(kept).toHaveLength(20);
    expect(kept.at(-1)!.kind).toBe("prompt");
    expect(kept.slice(0, 19).map((s) => s.name)).toEqual(list.slice(0, 19).map((s) => s.name));
  });
  it("keeps only the NEWEST welcome song, and does not move one that already fits", () => {
    const list = [song(40, "prompt"), ...Array.from({ length: 25 }, (_, i) => song(30 - i)), song(2, "prompt")];
    const kept = capKept(list);
    expect(kept[0]!.name).toBe("Song 40");
    expect(kept.filter((s) => s.kind === "prompt")).toHaveLength(1);
    expect(kept).toHaveLength(20);
  });
});

describe("the stored list", () => {
  it("after thirty more songs the welcome song is still there, once, on both the write and the read", () => {
    const st = memory();
    keepSong(st, song(1, "prompt"));
    for (let n = 2; n <= 31; n++) keepSong(st, song(n, "level"));
    const list = readKeptSongs(st);
    expect(list).toHaveLength(20);
    expect(list.filter((s) => s.kind === "prompt").map((s) => s.name)).toEqual(["Song 1"]);
    expect(list[0]!.name).toBe("Song 31");
  });
  it("a list that is already too long in storage is cut the same way on read", () => {
    const st = memory();
    st.setItem("tv.themeSongs.v1", JSON.stringify([...Array.from({ length: 24 }, (_, i) => song(30 - i, "level")), song(1, "prompt")]));
    const list = readKeptSongs(st);
    expect(list).toHaveLength(20);
    expect(list.at(-1)!.kind).toBe("prompt");
  });
  it("a song that is not a welcome song never takes a place from it, and a replay of the same task does not duplicate", () => {
    const st = memory();
    keepSong(st, song(1, "prompt")); keepSong(st, song(1, "prompt"));
    expect(readKeptSongs(st)).toHaveLength(1);
  });
});
