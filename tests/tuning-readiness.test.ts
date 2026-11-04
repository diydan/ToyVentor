/**
 * The repo's own proof that the tuning preparation is all there. If a file is deleted, or a document stops saying "not trained", this fails. The stage list is checked to be honest:
 * a stage is only "done" if its output file exists, and the training stage is never done from local files alone.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingPrep, PREP, stages } from "../scripts/tuning/lib/readiness";

const ROOT = join(__dirname, "..");

describe("the preparation is complete", () => {
  it("every file the preparation consists of is present", () => {
    expect(missingPrep(ROOT)).toEqual([]);
    expect(PREP.length).toBeGreaterThanOrEqual(25);
  });

  it("the npm commands exist for every stage", () => {
    const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    for (const k of ["tune:check", "tune:wishes", "tune:sample", "tune:build", "tune:eval"]) expect(scripts[k], k).toMatch(/^tsx scripts\/tuning\//);
  });

  it("the runbook and the model card say plainly what was and was not done: seven pilots, none passes both goals, none in use, no safety claim, no blind-test claim", () => {
    const readme = readFileSync(join(ROOT, "scripts/tuning/README.md"), "utf8");
    const card = readFileSync(join(ROOT, "scripts/tuning/MODEL_CARD.md"), "utf8");
    expect(readme).toContain("No model passes the decision rule under the goal \"both\" in any run");
    expect(readme).toContain("Nothing tuned is in use");
    expect(readme).toContain("the red-team seed is a blind test"); // in the column of what may NOT be said
    expect(card).toContain("NONE SHIPPED");
    expect(card).toContain("DO NOT SHIP");
    expect(card).toContain("no claim");
    expect(card).toContain("A pass is permission to run a model next to the base, not a claim of child safety");
    expect(card).toContain("not a blind test");
    expect(readme).toContain("never a claim");
  });

  it("the worked example in the repo is a STUB set: its manifest says so, so the trainer would refuse it", () => {
    const m = JSON.parse(readFileSync(join(ROOT, "scripts/tuning/data/example/dataset/manifest.json"), "utf8")) as { source: string; leaks: string[] };
    expect(m.source).toBe("stub");
    expect(m.leaks).toEqual([]);
    expect(readFileSync(join(ROOT, "scripts/tuning/data/example/dataset/DATASHEET.md"), "utf8")).toContain("STUB");
  });
});

describe("the stage list is honest", () => {
  it("in an empty folder nothing is done", () => {
    const root = mkdtempSync(join(tmpdir(), "tune-ready-"));
    try {
      for (const s of stages(root)) expect(s.state, s.name).toBe("not_run");
    } finally { rmSync(root, { recursive: true }); }
  });

  it("a stub dataset does not count as 'a dataset built from our model's answers', and training is never done from local files alone", () => {
    const root = mkdtempSync(join(tmpdir(), "tune-ready-"));
    try {
      mkdirSync(join(root, "scripts/tuning/data/dataset"), { recursive: true });
      writeFileSync(join(root, "scripts/tuning/data/dataset/manifest.json"), JSON.stringify({ source: "stub" }));
      writeFileSync(join(root, "scripts/tuning/data/wishes.jsonl"), "{}\n");
      const by = Object.fromEntries(stages(root).map((s) => [s.name, s.state]));
      expect(by["wishes written"]).toBe("done");
      expect(by["dataset built from OUR model's answers"]).toBe("not_run");
      expect(by["training run (Modal GPU)"]).toBe("not_run");
      writeFileSync(join(root, "scripts/tuning/data/dataset/manifest.json"), JSON.stringify({ source: "self" }));
      expect(Object.fromEntries(stages(root).map((s) => [s.name, s.state]))["dataset built from OUR model's answers"]).toBe("done");
    } finally { rmSync(root, { recursive: true }); }
  });

  it("no generated data is committed: the data folder ignores everything except the labelled stub example, so a fresh checkout has run nothing and says so", () => {
    const ignore = readFileSync(join(ROOT, "scripts/tuning/data/.gitignore"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    expect(ignore).toEqual(["*", "!.gitignore", "!example/", "!example/**"]);
    expect(existsSync(join(ROOT, "scripts/tuning/data/example/dataset/manifest.json"))).toBe(true);
  });
});
