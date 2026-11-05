import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error viewer JS modules ship without d.ts
import { describe as describeBuild, matchRecipeBook, normalizeBook } from "../parts/kip/viewer/kip-describe.js";
// @ts-expect-error viewer JS modules ship without d.ts
import { indexPartsData, validateRecipe } from "../parts/kip/viewer/kip-describe-validate.js";
// @ts-expect-error viewer JS modules ship without d.ts
import { approachProblems, buildFrame, DEFAULT_MARGIN, explodePlan, planOverlaps, worldBox } from "../parts/kip/viewer/kip-describe-view.js";
// @ts-expect-error viewer tools MJS module
import { compare as comparePublicMirror } from "../parts/kip/viewer/tools/sync_public.mjs";

const root = process.cwd();
const viewerDir = join(root, "parts/kip/viewer");
const publicKipDir = join(root, "public/kip");
const describeStlDir = join(publicKipDir, "partspec/describe");

function binaryStlBox(filePath: string): [number, number, number, number, number, number] {
  const buf = readFileSync(filePath);
  const triCount = buf.readUInt32LE(80);
  expect(84 + triCount * 50).toBe(buf.length);
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < triCount; t++) {
    for (let v = 0; v < 3; v++) {
      for (let k = 0 as 0 | 1 | 2; k < 3; k = (k + 1) as 0 | 1 | 2) {
        const val = buf.readFloatLE(84 + t * 50 + 12 + v * 12 + k * 4);
        if (val < lo[k]) lo[k] = val;
        if (val > hi[k]) hi[k] = val;
      }
    }
  }
  return [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]];
}

describe("Kip-Demo 'Describe & build' exploded-view tab", () => {
  const rawRecipes = JSON.parse(
    readFileSync(join(viewerDir, "kip-describe-recipes.json"), "utf8"),
  );
  const rawParts = JSON.parse(
    readFileSync(join(viewerDir, "kip-describe-parts.json"), "utf8"),
  );
  const book = normalizeBook(rawRecipes);
  const partsData = indexPartsData(rawParts);

  it("keeps viewer/ and public/kip/ copies byte-identical and mounts in Kip-Demo.html", () => {
    const mirrorStates = comparePublicMirror() as Array<{
      file: string;
      state: string;
    }>;
    expect(mirrorStates.length).toBeGreaterThanOrEqual(6);
    for (const item of mirrorStates) {
      expect(item.state, `${item.file} drifted`).toBe("same");
    }

    for (const f of ["Kip-Demo.html", "kip-bench.js"]) {
      expect(readFileSync(join(publicKipDir, f), "utf8"), `public/kip/${f} drifted (run npm run build:kip)`).toBe(readFileSync(join(viewerDir, f), "utf8"));
    }
    // Since Workshop stage 4a the page script (and its mountDescribe call) lives in kip-bench.js.
    expect(readFileSync(join(viewerDir, "kip-bench.js"), "utf8")).toContain("mountDescribe(");
  });

  it("the book is wide: sixty-odd builds, every one validated, named and findable by what a child calls it (2026-11-05: riders, hats and vehicles swapped between validated builds, each accepted by the real assembly validator)", () => {
    const ids = book.recipes.map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(66);
    expect(ids.slice(0, 10).every((id: string, i: number) => book.recipes[i].featured), "the first ten are still the featured examples").toBe(true);
    for (const r of book.recipes) {
      expect(typeof r.title === "string" && r.title.length > 2, `${r.id} title`).toBe(true);
      expect(typeof r.description === "string" && r.description.length > 2, `${r.id} description`).toBe(true);
      expect(Array.isArray(r.keywords) && r.keywords.length >= 3, `${r.id} has synonyms`).toBe(true);
      expect(r.reference?.poses && Object.keys(r.reference.poses).length === r.steps.length, `${r.id} carries the validator's poses for every step`).toBe(true);
      expect(r.reference.validator.ok, `${r.id} passed the real validator`).toBe(true);
      expect(r.reference.validator.errors, r.id).toBe(0);
    }
    // a build is not the same build under another name, except the three the first thirty-five already had (the 30 parts cannot tell a monster truck from a dump truck, a taxi from a race
    // car, or a stomper from a grabber robot): the part, how it mates, to what, and where, for every step
    const sig = (r: { steps: Array<{ id: string; part: string; mate?: { conn: string; host: string; hostConn: string; along?: string } }> }) => {
      const part = new Map(r.steps.map((s) => [s.id, s.part]));
      return r.steps.map((s) => [s.part, s.mate?.conn ?? "", part.get(s.mate?.host ?? "") ?? "", s.mate?.hostConn ?? "", s.mate?.along ?? ""].join("|")).sort().join(";");
    };
    const seen = new Map<string, string>(), aliases: string[] = [];
    for (const r of book.recipes) { const k = sig(r); if (seen.has(k)) aliases.push(`${r.id}=${seen.get(k)}`); else seen.set(k, r.id); }
    expect(aliases.sort()).toEqual(["monster-truck=dump-truck", "stomper-robot=grabber-robot", "taxi=race-car"]);
  });

  it("the words a child is likely to use find a sensible build offline, and what the parts cannot make is called a starting point (the Worker, with Muse, is the main path; this is the fallback the tab uses when it is offline or the route fails)", () => {
    const WISHES: Array<[string, string, "high" | "medium"]> = [
      ["a police car", "taxi", "medium"], ["a fire truck", "bull-bar-truck", "medium"], ["a school bus", "family-car-roof-rack", "high"], ["a camper van", "family-car-roof-rack", "high"],
      ["an ice cream truck", "dump-truck", "high"], ["a dune buggy", "go-kart", "high"], ["a hot rod", "race-car", "medium"], ["a car with a roof box", "family-car-roof-rack", "high"],
      ["a cowboy in a race car", "cowboy-race-car", "high"], ["a ranger on a skateboard", "ranger-skateboard", "high"], ["a ranger on a scooter", "ranger-scooter", "high"],
      ["a robot in a monster truck", "robot-monster-truck", "high"], ["a robot in an off-road jeep", "robot-jeep", "high"], ["Kip in a go-kart", "kip-go-kart", "high"],
      ["a fancy Kip in a go-kart", "fancy-go-kart", "high"], ["a girl with a bob haircut on a scooter", "bob-scooter", "high"], ["a cowboy with a jetpack", "cowboy-jetpack", "high"],
      ["a robot with a ranger hat", "robot-ranger", "high"], ["Kip in a top hat", "kip-top-hat", "high"],
    ];
    for (const [wish, id, confidence] of WISHES) {
      const m = matchRecipeBook(wish, book);
      expect(m.recipeId, wish).toBe(id);
      expect(m.confidence === "high" || (confidence === "medium" && m.confidence === "medium"), `${wish}: ${m.confidence}`).toBe(true);
    }
    // what 30 parts cannot make is never passed off as a match: it is a low-confidence starting point, which the tab says so
    for (const wish of ["a helicopter", "a pirate", "a bulldozer", "a boat", "a train"]) expect(matchRecipeBook(wish, book).confidence, wish).toBe("low");
  });

  it("validates every recipe in the book against fit_matrix connector rules and matches offline", async () => {
    // The first ten are the hand-picked originals, shown as the tab's example buttons (`featured`); the rest were invented by Muse and passed the real validator.
    expect(book.recipes.filter((r: { featured?: boolean }) => r.featured)).toHaveLength(10);
    expect(book.recipes.length).toBeGreaterThanOrEqual(30);
    expect(book.recipes.map((r: { id: string }) => r.id)).toContain("tractor");
    expect(book.allowedIds).toHaveLength(30);

    for (const recipe of book.recipes) {
      const verdict = validateRecipe(recipe.steps, partsData, {
        allowedIds: book.allowedIds,
      });
      expect(verdict.ok, `${recipe.id}: ${JSON.stringify(verdict.errors)}`).toBe(
        true,
      );
      expect(verdict.errors).toEqual([]);

      const matched = matchRecipeBook(recipe.description, book);
      expect(matched.recipeId).toBe(recipe.id);
      expect(matched.confidence).toBe("high");

      const offlineResult = await describeBuild(recipe.description, {
        book,
        parts: partsData,
      });
      expect(offlineResult.validated).toBe(true);
      expect(offlineResult.source).toBe("recipe-book");
      expect(offlineResult.poses).toEqual(recipe.reference.poses);
    }

    // Rejects an illegal connector mate with a plain-English message + suggestion
    const badSteps = book.recipes[4].steps.map((s: Record<string, unknown>) =>
      s.id === "hat"
        ? {
            ...s,
            mate: { conn: "under_sockets", host: "head", hostConn: "face_slot" },
          }
        : s,
    );
    const badVerdict = validateRecipe(badSteps, partsData, {
      allowedIds: book.allowedIds,
    });
    expect(badVerdict.ok).toBe(false);
    expect(badVerdict.errors.length).toBeGreaterThan(0);
  });

  it("separates every curated recipe with zero pairwise bbox overlap at full spread and clean seat timeline", () => {
    const localBoxes: Record<string, number[]> = {};
    for (const id of book.allowedIds as string[]) {
      const stlPath = join(describeStlDir, `${id}.stl`);
      expect(existsSync(stlPath), `missing ${stlPath}`).toBe(true);
      localBoxes[id] = binaryStlBox(stlPath);
    }

    for (const recipe of rawRecipes.recipes) {
      // Assembled pose boxes match PartSpec validator reference within 0.02 mm
      for (const step of recipe.steps) {
        const computed = worldBox(
          localBoxes[step.part],
          recipe.reference.poses[step.id],
        ) as number[];
        const expected = recipe.reference.boxes[step.id] as number[];
        for (let k = 0; k < 6; k++) {
          expect(Math.abs(computed[k]! - expected[k]!), `${recipe.id} / ${step.id} (${step.part}) box[${k}]: page ${computed[k]} vs validator ${expected[k]}`).toBeLessThan(0.02);
        }
      }

      // Exploded view at t = 1 has zero pairwise overlaps (at least DEFAULT_MARGIN = 8 mm clearance)
      const plan = explodePlan(
        recipe.steps,
        recipe.reference.poses,
        localBoxes,
        rawParts,
      );
      expect(planOverlaps(plan, DEFAULT_MARGIN)).toEqual([]);
      expect(approachProblems(plan)).toEqual([]);

      // Step-by-step build timeline seats strictly one part at a time
      const totalSteps = recipe.steps.length;
      const frameStart = buildFrame(totalSteps, 0);
      expect(frameStart.every((f: { visible: boolean }) => !f.visible)).toBe(true);
      const frameEnd = buildFrame(totalSteps, totalSteps);
      expect(
        frameEnd.every(
          (f: { visible: boolean; away: number }) => f.visible && f.away === 0,
        ),
      ).toBe(true);
    }
  });
});
