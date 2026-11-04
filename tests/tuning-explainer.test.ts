/**
 * What Forge is, in one place (scripts/tuning/lib/forgeExplainer.ts): the explanation that opens BOTH the one-page pitch and the charts page. One source so they cannot disagree, and the numbers it quotes
 * are the ones the caller computed from the run files (nothing typed here). The generated pages are checked when they are on disk (they are committed, so they should be).
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forgeExplainer, forgePipelineSvg } from "../scripts/tuning/lib/forgeExplainer";

const N = { warmSeconds: 13.1, tunedMain: 13.1, baseMain: 28.4, speedMainPct: 54, speedBlindPct: 54 };

describe("forgeExplainer", () => {
  const ex = forgeExplainer(N);
  it("says what a child does, how it works, how it was trained, why, and what ships with the honest limits", () => {
    expect(ex.intro).toContain("a pink princess hat");
    expect(ex.how).toContain("our own tuned Muse Glimmer 30B");
    expect(ex.how).toContain("The model never emits mesh");
    expect(ex.trained).toContain("not the hosted Spark model");
    expect(ex.why).toContain("Kids can't use the hosted model");
    expect(ex.ships).toContain("FORGE_FAST_MODE=off");
    for (const limit of ["blind test half is sealed", "native", "risk assessment is unsigned", "never measured"]) expect(ex.ships.toLowerCase()).toContain(limit.toLowerCase());
  });
  it("quotes only the numbers it is given", () => {
    expect(ex.intro).toContain("About 13 seconds");
    expect(ex.why).toContain("About 54% faster median on the main set (13.1 vs 28.4 s)");
    expect(forgeExplainer({ ...N, tunedMain: 9.9, baseMain: 30, speedMainPct: 67 }).why).toContain("About 67% faster median on the main set (9.9 vs 30 s)");
  });
  it("makes no claim of child safety", () => {
    const all = Object.values(ex).join(" ").toLowerCase();
    expect(all).not.toMatch(/kid[- ]safe|safe for (kids|children)|child[- ]safe/);
  });
  it("the pipeline picture has a text alternative that names every step and the retry loop", () => {
    const svg = forgePipelineSvg();
    expect(svg).toContain('role="img"');
    for (const step of ["intake checks", "tuned model writes a recipe", "names are checked", "code builds the part", "print gates check it", "printable file", "at most four tries"]) expect(svg.toLowerCase()).toContain(step);
  });
  it("both generated pages carry the same explanation (when they are on disk)", () => {
    for (const f of ["scripts/tuning/results/charts.html", "scripts/tuning/results/pitch.html"]) {
      if (!existsSync(f)) continue;
      const html = readFileSync(f, "utf8");
      expect(html, f).toContain("The model never emits mesh; code builds and checks it.");
      expect(html, f).toContain("Kids can't use the hosted model.");
      expect(html, f).toContain("the risk assessment is unsigned");
    }
    for (const f of ["scripts/tuning/charts.ts", "scripts/tuning/pitch.ts"]) expect(readFileSync(f, "utf8"), f).toContain("forgeExplainer");
  });
});
