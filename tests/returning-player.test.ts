// A returning player (src/lib/returningPlayer.ts, ForgetPlayerButton.tsx, and their wiring in TitleMenu, GrownUpsSheet and GameCanvas): the title greets the saved player by name and offers a
// different player instead of the first-run setup; a grown-up forgets them with two taps; forgetting removes the profile and nothing else.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROFILE_KEY, buildProfile, saveProfile, readProfile, type Store } from "../src/lib/newPlayer";
import { FORGET_ARM_MS, describeSetup, forgetPlayer, nextForgetTap, notYouLabel, notYouLine, safeName, welcomeBack, welcomeLine } from "../src/lib/returningPlayer";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const mem = (seed: Record<string, string> = {}): Store & { data: Record<string, string> } => {
  const data: Record<string, string> = { ...seed };
  return { data, getItem: (k) => (k in data ? data[k]! : null), setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
};
const made = (kidName = "Mia", createdAt = "2026-11-05T09:30:00.000Z") => {
  const r = buildProfile({ under13: true, kidName, parentName: "Sam", favourites: { colour: "blue", fruit: "apple", animal: "elephant" }, songConsent: true }, createdAt);
  if (!r.ok) throw new Error(r.problem);
  return r.profile;
};

describe("what the title says", () => {
  it("welcomes a saved player by name, and says nothing without a usable one", () => {
    expect(welcomeBack(made())).toBe("Welcome back, Mia!");
    expect(welcomeLine("Jean-Luc")).toBe("Welcome back, Jean-Luc!");
    for (const bad of [null, undefined, "", "   ", 5, {}, "Mia2", "mia@x.com", "<b>Mia</b>", "a".repeat(21)]) expect(welcomeLine(bad), String(bad)).toBeNull();
    expect(welcomeBack(null)).toBeNull();
    expect(welcomeBack(undefined)).toBeNull();
  });
  it("offers a different player by name, and still offers the way out when the name is not usable", () => {
    expect(notYouLabel(made())).toBe("Not Mia? Set up a different player");
    expect(notYouLine("Zoë")).toBe("Not Zoë? Set up a different player");
    for (const bad of [null, undefined, "", "Mia!", "<script>"]) expect(notYouLine(bad), String(bad)).toBe("Set up a different player");
    expect(notYouLabel(null)).toBe("Set up a different player");
  });
  it("only ever repeats a name that passes the setup's own rule: a hand-edited value never reaches the screen", () => {
    expect(safeName("  Mary   Ann ")).toBe("Mary Ann");
    expect(safeName("x@y.com")).toBeNull();
    expect(welcomeLine("http://evil")).toBeNull();
    expect(notYouLine("<img src=x onerror=1>")).toBe("Set up a different player");
  });
});

describe("what the Grown-Ups sheet says", () => {
  it("says when the player was set up (UTC date), with the year only when it is not this year", () => {
    expect(describeSetup(made(), "2026-11-05T10:00:00.000Z")).toBe("Mia was set up on this device on 5 Nov.");
    expect(describeSetup(made("Mia", "2025-01-31T23:59:59.000Z"), "2026-11-05T10:00:00.000Z")).toBe("Mia was set up on this device on 31 Jan 2025.");
  });
  it("is null-safe: no profile is an empty string, a bad date still names the player, a bad name says nothing", () => {
    expect(describeSetup(null, "2026-11-05T10:00:00.000Z")).toBe("");
    expect(describeSetup(undefined, "")).toBe("");
    expect(describeSetup({ kidName: "Mia", createdAt: "not a date" }, "2026-11-05T10:00:00.000Z")).toBe("Mia is set up on this device.");
    expect(describeSetup({ kidName: "Mia", createdAt: undefined as unknown as string }, "2026-11-05T10:00:00.000Z")).toBe("Mia is set up on this device.");
    expect(describeSetup({ kidName: "M1a", createdAt: "2026-11-05T09:30:00.000Z" }, "2026-11-05T10:00:00.000Z")).toBe("");
    expect(describeSetup(made(), "garbage")).toBe("Mia was set up on this device on 5 Nov 2026.");
  });
});

describe("forgetting", () => {
  it("removes ONLY the profile: the game save, the kept songs, the device id and every setting stay", () => {
    const other = { tf25: '{"sel":{}}', "tv.themeSongs.v1": "[1]", "toyforge:device:v1": "dev-1234", "toyforge:prop-lang:v1": "es", tvTimeOfDay: "night" };
    const s = mem(other);
    saveProfile(s, made());
    expect(readProfile(s)).not.toBeNull();
    expect(forgetPlayer(s)).toBe(true);
    expect(PROFILE_KEY in s.data).toBe(false);
    expect(s.data).toEqual(other);
    expect(readProfile(s)).toBeNull();
  });
  it("says false when there was nothing to forget, and when storage is missing or blocked", () => {
    expect(forgetPlayer(mem({ a: "1" }))).toBe(false);
    expect(forgetPlayer(null)).toBe(false);
    expect(forgetPlayer(undefined)).toBe(false);
    expect(forgetPlayer({ getItem: () => { throw new Error("blocked"); }, setItem: () => {}, removeItem: () => {} })).toBe(false);
    const stuck: Store = { getItem: () => "x", setItem: () => {}, removeItem: () => { throw new Error("blocked"); } };
    expect(forgetPlayer(stuck)).toBe(false);
  });
  it("is two taps: the first arms it, a second inside five seconds forgets, a late second tap only arms it again", () => {
    expect(FORGET_ARM_MS).toBe(5000);
    const first = nextForgetTap(null, 1000);
    expect(first).toEqual({ armedAt: 1000, forget: false });
    expect(nextForgetTap(first.armedAt, 3000)).toEqual({ armedAt: null, forget: true });
    expect(nextForgetTap(first.armedAt, 6000)).toEqual({ armedAt: null, forget: true }); // exactly at the edge still counts
    expect(nextForgetTap(first.armedAt, 6001)).toEqual({ armedAt: 6001, forget: false });
    expect(nextForgetTap(first.armedAt, 999)).toEqual({ armedAt: 999, forget: false }); // a clock that went backwards never forgets
    expect(nextForgetTap(Number.NaN, 2000)).toEqual({ armedAt: 2000, forget: false });
  });
});

describe("how it is wired", () => {
  const title = read("src/features/game/world/TitleMenu.tsx");
  const sheet = read("src/features/game/world/GrownUpsSheet.tsx");
  const canvas = read("src/features/game/world/GameCanvas.tsx");
  const button = read("src/features/game/world/ForgetPlayerButton.tsx");

  it("the title shows the welcome line and, for a saved player, the 'Not Mia?' link instead of the first-run text; without a player the old text is untouched", () => {
    expect(title).toContain("playerName?: string;");
    expect(title).toContain("const welcome = welcomeLine(playerName);");
    expect(title).toContain('{welcome ? <p className="tv-title-welcome" data-title-welcome>{welcome}</p> : null}');
    expect(title).toContain('{welcome ? notYouLine(playerName) : "New here? Set up a player with a grown-up"}');
    expect(title).toContain("data-new-player"); // the same link, so the setup is still one tap away
  });
  it("the Grown-Ups group names the player, offers a different one, and offers the two-tap forget only when the caller can forget", () => {
    expect(sheet).toContain("playerName?: string;");
    expect(sheet).toContain("onForgetPlayer?: () => void;");
    expect(sheet).toContain("const welcome = safeName(playerName);");
    expect(sheet).toContain('{welcome ? "Set up a different player" : "Set up a new player"}');
    expect(sheet).toContain("{welcome && onForgetPlayer ? <ForgetPlayerButton name={welcome} onForget={onForgetPlayer} /> : null}");
  });
  it("the button says what it will do, changes on the first tap, and resets after five seconds", () => {
    expect(button).toContain('`Tap again to forget ${name}`');
    expect(button).toContain('"Forget this player"');
    expect(button).toContain("nextForgetTap(armedAt.current, Date.now())");
    expect(button).toContain("}, FORGET_ARM_MS);");
  });
  it("the game reads the profile once, refreshes it when the setup closes, forgets only through forgetPlayer, and passes the name to both", () => {
    expect(canvas).toContain("useState<PlayerProfile | null>(() => { try { return readProfile(window.localStorage); } catch { return null; } });");
    expect(canvas).toContain("try { forgetPlayer(window.localStorage); }");
    expect(canvas).toContain("setPlayer(null);");
    expect(canvas).toContain("<OnboardingSheet onClose={() => { setOnboardOpen(false); try { setPlayer(readProfile(window.localStorage)); }");
    expect(canvas).toContain("playerName={player?.kidName} />}"); // TitleMenu (its JSX pin in tests/title-menu.test.ts)
    expect(canvas).toContain("          playerName={player?.kidName}\n          onForgetPlayer={forgetThisPlayer}\n");
    expect(canvas).not.toMatch(/localStorage\.removeItem|clear\(\)/); // nothing else in this wiring wipes storage
  });
  it("forgetting does not reach into anything but the one key", () => {
    const lib = read("src/lib/returningPlayer.ts");
    expect(lib.match(/removeItem\(/g)).toHaveLength(1);
    expect(lib).toContain("store.removeItem(PROFILE_KEY);");
  });
});
