import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildManifest, enumeratePrompts, serializeManifest } from "../scripts/lib/scene-prompts-enum";
import { LEARN_RUNGS, learnRungDef } from "../src/features/game/world/runtime/learnRungs";
import { arriveScene, arriveSceneVisit, startSceneCarry, startSceneVisit, tapSceneItem, tapSceneSpot, tapSceneTarget } from "../src/features/game/world/runtime/level2Scene";
import { householdTextHash } from "../src/lib/householdNames";
import { SCENE_PROMPTS, isPromptId, promptIdForText, promptText, scenePromptUrl } from "../src/lib/scenePrompts";
import { promptId } from "../src/lib/scenePromptId";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "src/lib/scenePrompts.json");
const WORLD = join(ROOT, "src/features/game/world/runtime/world.ts");
const TSX = join(ROOT, "node_modules/.bin/tsx");

describe("the closed list of Carousel scene prompts (src/lib/scenePrompts.json)", () => {
  it("is exactly what the scene code can say: when this fails run `npx tsx scripts/scene-prompts.ts` and commit the file", () => {
    expect(readFileSync(MANIFEST, "utf8")).toBe(serializeManifest(buildManifest()));
  });

  it("gives every line the fingerprint of its text as its id: unique, 8 hex digits, the same function as the household clips' fingerprint", () => {
    expect(SCENE_PROMPTS.length).toBeGreaterThan(50);
    for (const p of SCENE_PROMPTS) {
      expect(p.id, p.text).toMatch(/^[0-9a-f]{8}$/);
      expect(promptId(p.text), p.text).toBe(p.id);
      expect(householdTextHash(p.text), p.text).toBe(p.id);
    }
    expect(new Set(SCENE_PROMPTS.map((p) => p.id)).size).toBe(SCENE_PROMPTS.length);
    expect(new Set(SCENE_PROMPTS.map((p) => p.text)).size).toBe(SCENE_PROMPTS.length);
  });

  it("holds plain, short English lines: nothing empty, nothing that is only a symbol, nothing too long to say in a moment", () => {
    for (const p of SCENE_PROMPTS) {
      expect(p.text, p.id).toBe(p.text.trim());
      expect(p.text, p.id).toMatch(/^[A-Za-z0-9][\x20-\x7E—]*[.!?]$/);
      expect(p.text.length, p.text).toBeLessThanOrEqual(120);
    }
  });

  it("looks lines up by id and by EXACT text, and an id is only an id if it is in the list", () => {
    const p = SCENE_PROMPTS.find((x) => x.text === "Go get the ball.")!;
    expect(promptText(p.id)).toBe("Go get the ball.");
    expect(promptIdForText("Go get the ball.")).toBe(p.id);
    expect(isPromptId(p.id)).toBe(true);
    expect(scenePromptUrl(p.id)).toBe(`/api/voice?s=${p.id}`);
    // not trimmed, not re-cased, not a prefix: the server must only ever be asked for a line it was built from
    for (const t of ["Go get the ball", "go get the ball.", "Go get the ball. ", " Go get the ball.", "Go get the", ""]) expect(promptIdForText(t), JSON.stringify(t)).toBeNull();
    for (const id of ["", "constructor", "__proto__", "toString", "00000000", p.id.toUpperCase(), `${p.id} `, "Go get the ball."]) expect(isPromptId(id), JSON.stringify(id)).toBe(false);
    expect(isPromptId(undefined)).toBe(false);
    expect(promptText("constructor")).toBeNull();
  });

  it("has a line for the win text of every rung that is played in a scene, and every line has a scene it comes from", () => {
    const from = enumeratePrompts();
    let scened = 0;
    for (const def of LEARN_RUNGS) {
      if (!startSceneCarry(def.missionId) && !startSceneVisit(def.missionId)) continue;
      scened++;
      expect(promptIdForText(def.winText), def.missionId).not.toBeNull();
    }
    expect(scened).toBe(6); // little.pop, animals, pack, peek, gogo, tidy
    for (const p of SCENE_PROMPTS) expect(from.get(p.text)?.length, p.text).toBeGreaterThan(0);
  });

  it("includes the counts world.ts builds itself, one per carry rung", () => {
    expect(promptIdForText("3 things to put away. Tap one.")).not.toBeNull(); // little.pack has three things
    expect(promptIdForText("2 things to put away. Tap one.")).not.toBeNull(); // little.tidy has two
  });
});

/** A small deterministic generator, so the playthrough below is the same on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("a playthrough with the real scene functions", () => {
  // The enumerator walks every state in turn; this plays at random instead, speaking exactly what world.ts speaks, so a rule the enumerator got wrong cannot hide.
  it("never says a line that is not in the list, and over a long random game says every line in it", () => {
    const rand = lcg(20261103);
    const spoken = new Set<string>();
    const say = (t: string) => void spoken.add(t);
    const known = new Set(SCENE_PROMPTS.map((p) => p.text));
    const winTextOf = (id: string) => learnRungDef(id)?.winText ?? "All done!";
    const ids = LEARN_RUNGS.map((r) => r.missionId);
    for (const id of ids) {
      for (let game = 0; game < 400; game++) {
        const carry = startSceneCarry(id);
        const visit = carry ? null : startSceneVisit(id);
        if (!carry && !visit) break;
        if (carry) say(`${carry.params.items.length} things to put away. Tap one.`);
        if (visit) say(visit.recipe.intro);
        for (let step = 0; step < 60; step++) {
          if (carry) {
            const pickItem = rand() < 0.5;
            const r = pickItem
              ? tapSceneItem(carry, carry.params.items[Math.floor(rand() * carry.params.items.length)]!.id, 0)
              : tapSceneTarget(carry, carry.params.targets[Math.floor(rand() * carry.params.targets.length)]!.id, 0);
            say(r.say);
            if (r.action !== "goto") continue;
            const a = arriveScene(carry);
            if (!a) continue;
            if (a.event === "picked" || a.event === "placed") say(a.say);
            else if (a.event === "wrong") say(`${a.say} ${a.hint}`);
            else {
              say(winTextOf(id));
              break;
            }
          } else if (visit) {
            const r = tapSceneSpot(visit, visit.recipe.spots[Math.floor(rand() * visit.recipe.spots.length)]!.id, 0);
            say(r.say);
            if (r.action !== "goto") continue;
            const a = arriveSceneVisit(visit);
            if (!a) continue;
            if (a.event === "wrong") say(`${a.say} ${a.hint}`);
            else {
              say(a.say);
              if (a.event === "done") {
                say(winTextOf(id));
                break;
              }
            }
          }
        }
      }
    }
    expect([...spoken].filter((t) => !known.has(t))).toEqual([]);
    expect([...known].filter((t) => !spoken.has(t) && t !== "All done!")).toEqual([]); // "All done!" is only said by a tap after the last spot, which the game does not allow
  });
});

describe("world.ts speaks only through the call sites the list was built from", () => {
  // world.ts belongs to another lane and changes: when this fails, a spoken line was added, moved or reworded there. Read what it now says, teach
  // scripts/lib/scene-prompts-enum.ts about it (so the line is in the list), run `npx tsx scripts/scene-prompts.ts`, then update the table below.
  const world = readFileSync(WORLD, "utf8").replace("function sayT(t: string){toast(t);say(t)}", "");
  const count = (list: string[]) => {
    const out: Record<string, number> = {};
    for (const a of list) out[a] = (out[a] ?? 0) + 1;
    return out;
  };

  it("hands exactly these arguments to sayT (the toast + voice twin)", () => {
    expect(count([...world.matchAll(/sayT\(([^()]*)\)/g)].map((m) => m[1]!))).toEqual({
      "ar.say": 3, // an item picked up, an item placed, a visit's expected arrival
      'ar.say+" "+ar.hint': 2, // a drop that does not fit, an out-of-order arrival
      "ri.say": 1, // a tap on an item
      "rt.say": 1, // a tap on a target
      "vr.say": 1, // a tap on a spot
      "vs0.recipe.intro": 1,
      'session.params.items.length+" things to put away. Tap one."': 1,
    });
  });

  it("speaks nothing else directly: only the win text, after the last drop and the last spot", () => {
    expect(count([...world.matchAll(/(?<![A-Za-z0-9_$.])say\(([^()]*)\)/g)].map((m) => m[1]!))).toEqual({ wtxt: 1, wtxt2: 1 });
    expect(world.match(/var wtxt=wdef\?wdef\.winText:"All done!"/g)).toHaveLength(1);
    expect(world.match(/var wtxt2=wdef2\?wdef2\.winText:"All done!"/g)).toHaveLength(1);
  });
});

describe("the scripts", () => {
  it("`scene-prompts.ts --check` passes on the committed list", () => {
    const out = execFileSync(TSX, ["scripts/scene-prompts.ts", "--check"], { cwd: ROOT, encoding: "utf8" });
    expect(out).toContain(`up to date (${SCENE_PROMPTS.length} lines)`);
  }, 60_000);

  it("`prewarm-voice.ts --list` asks for every scene prompt by id, in English, once", () => {
    const out = execFileSync(TSX, ["scripts/prewarm-voice.ts", "--list"], { cwd: ROOT, encoding: "utf8" }).split("\n");
    const asked = out.filter((l) => l.startsWith("/api/voice?s="));
    expect(asked.sort()).toEqual(SCENE_PROMPTS.map((p) => scenePromptUrl(p.id)).sort());
    expect(out[0]).toContain(`${SCENE_PROMPTS.length} scene prompts`);
  }, 60_000);

  it("`prewarm-voice.ts --only` (a few household clips to listen to) leaves the prompts alone", () => {
    const out = execFileSync(TSX, ["scripts/prewarm-voice.ts", "--list", "--only", "banana"], { cwd: ROOT, encoding: "utf8" });
    expect(out).not.toContain("/api/voice?s=");
  }, 60_000);
});
