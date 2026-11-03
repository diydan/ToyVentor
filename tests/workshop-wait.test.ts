import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain browser module (no types); its pure helpers are exported so they can be tested here
import { PILE_HELD_BACK, PILE_SIZE, STAGES, resolveStage, stagedPile, timedPile } from "../parts/kip/viewer/kip-workshop-wait.js";

// The waiting state shared by the Describe & build tab and the photo "Print it" panel. The DOM behaviour is covered in a real browser by
// parts/kip/viewer/tools/e2e_workshop_wait.mjs (staged mode) and e2e_describe.mjs section [5c] (timed mode); this file holds the pure rules and the wiring.
const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("the pile never claims the work is done before the answer", () => {
  it("holds the last bricks back in both modes, however long it waits or whatever stage it is told", () => {
    expect(PILE_SIZE).toBe(10);
    expect(PILE_HELD_BACK).toBeGreaterThanOrEqual(1);
    for (const secs of [0, 1, 5, 30, 600, 1e9]) expect(timedPile(secs)).toBeLessThanOrEqual(PILE_SIZE - PILE_HELD_BACK);
    for (const floor of [0, 3, 7, 8, 9, 10, 50]) for (const secs of [0, 5, 600]) expect(stagedPile(floor, secs)).toBeLessThanOrEqual(PILE_SIZE - PILE_HELD_BACK);
  });
  it("timed: starts empty, only goes up, and a negative clock is treated as zero", () => {
    expect(timedPile(0)).toBe(0);
    expect(timedPile(-3)).toBe(0);
    let last = 0;
    for (let s = 0; s <= 60; s += 0.5) { const n = timedPile(s); expect(n).toBeGreaterThanOrEqual(last); last = n; }
    expect(timedPile(60)).toBe(PILE_SIZE - PILE_HELD_BACK);
  });
  it("staged: finished stages count, and a stage running 5 s or more adds exactly one more brick", () => {
    expect(stagedPile(4, 0)).toBe(4);
    expect(stagedPile(4, 4.9)).toBe(4);
    expect(stagedPile(4, 5)).toBe(5);
    expect(stagedPile(4, 500)).toBe(5);
    expect(stagedPile(-2, 0)).toBe(0);
  });
  it("every stage's floor sits below the held-back bricks, and the stages only get further along the work", () => {
    for (const [name, def] of Object.entries(STAGES) as Array<[string, { floor: number }]>) expect(def.floor, name).toBeLessThanOrEqual(PILE_SIZE - PILE_HELD_BACK);
    expect(STAGES.asking.floor).toBeLessThan(STAGES.preview.floor);
    expect(STAGES.preview.floor).toBeLessThan(STAGES.checking.floor);
    expect(STAGES.checking.floor).toBeLessThan(STAGES.fetching.floor);
  });
});

describe("stage names", () => {
  it("accepts its own names and a Forge job's statuses (spec: forge-ai-spec.md, Naming and the waiting state)", () => {
    for (const n of Object.keys(STAGES)) expect(resolveStage(n)).toBe(n);
    expect(resolveStage("queued")).toBe("asking");
    expect(resolveStage("proposing")).toBe("asking");
    expect(resolveStage("asking_again")).toBe("asking");
    expect(resolveStage("preview_ready")).toBe("preview");
    expect(resolveStage("validating")).toBe("checking");
    expect(resolveStage("optimizing")).toBe("checking");
    expect(resolveStage("repairing")).toBe("repair");
    expect(resolveStage("waiting")).toBe("rest");
    expect(resolveStage("fetching_plate")).toBe("fetching");
  });
  it("refuses everything else, including names every object inherits", () => {
    for (const bad of ["", "nope", "constructor", "__proto__", "toString", "hasOwnProperty", "print_ready", "failed", 0, 42, null, undefined, {}, ["asking"]]) expect(resolveStage(bad), String(bad)).toBeNull();
  });
  it("every stage has words, and a rest says the real seconds", () => {
    for (const [name, def] of Object.entries(STAGES) as Array<[string, { label: (d: { call: number; left: number }) => string }]>) expect(def.label({ call: 1, left: 4 }), name).toMatch(/\S/);
    expect(STAGES.rest.label({ call: 1, left: 8 })).toContain("8 s");
    expect(STAGES.checking.label({ call: 3, left: 0 })).toContain("try 3");
    expect(STAGES.checking.label({ call: 1, left: 0 })).not.toContain("try");
  });
});

describe("one workshop, two hosts, nothing global", () => {
  const mod = read("parts/kip/viewer/kip-workshop-wait.js");
  it("builds its elements from the document it is given and reaches for no global DOM, listener or storage", () => {
    expect(mod).toContain("doc = globalThis.document");
    expect(mod).not.toMatch(/\bwindow\./);
    expect(mod).not.toMatch(/(^|[^.\w])document\./m);
    expect(mod).not.toMatch(/\baddEventListener\s*\(\s*['"](resize|keydown|scroll|visibilitychange)/);
    expect(mod).not.toMatch(/localStorage|sessionStorage|fetch\(/);
  });
  it("is the only copy: the Describe & build tab imports it and no longer carries its own", () => {
    const tab = read("parts/kip/viewer/kip-describe-tab.js");
    expect(tab).toMatch(/import \{[^}]*createWorkshop[^}]*\} from '\.\/kip-workshop-wait\.js'/);
    expect(tab).not.toMatch(/function createWorkshop|function brickSvg|const PILE_SPOTS|kdb-workshop|kdb-brick/);
  });
  it("is copied by the Kip build and mirrored to public/kip, beside the tab that needs it", () => {
    expect(read("scripts/build-kip.ts")).toContain('"viewer/kip-workshop-wait.js"');
    expect(read("parts/kip/viewer/tools/sync_public.mjs")).toContain("'kip-workshop-wait.js'");
    expect(readFileSync(join(root, "public/kip/kip-workshop-wait.js"))).toEqual(readFileSync(join(root, "parts/kip/viewer/kip-workshop-wait.js")));
  });
  it("the photo print panel imports it too, so a stage report reaches the strip", () => {
    const panel = read("parts/kip/viewer/kip-photo-print.js");
    expect(panel).toMatch(/import \{[^}]*createWorkshop[^}]*\} from '\.\/kip-workshop-wait\.js'/);
    expect(panel).toMatch(/workshop\.setStage\(/);
  });
});
