import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// How the print panel is wired into the Kip page (Workshop stage 4a: the page's markup, style and script live in kip-bench.js) and into the
// build. These read files outside the photo-outline lane (kip-bench.js, scripts/build-kip.ts), so they live apart from
// tests/photo-print-flow.test.ts: a missing or half-moved page must fail these, not stop the flow tests from loading.

describe("the print panel in the Kip page", () => {
  const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
  const bench = read("parts/kip/viewer/kip-bench.js");
  const panel = read("parts/kip/viewer/kip-photo-print.js");
  const build = read("scripts/build-kip.ts");

  it("the build copies the panel, and bundles its logic from shared/photoPrintFlow.ts into the file the panel imports", () => {
    expect(build).toContain("viewer/kip-photo-print.js");
    expect(build).toContain("shared/photoPrintFlow.ts");
    expect(build).toContain("kip-photo-print-core.js");
    for (const m of panel.matchAll(/from\s+['"]\.\/([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)) {
      const copied = build.includes(`viewer/${m[1]}`);
      const generated = m[1] === "kip-photo-print-core.js";
      expect(copied || generated, `${m[1]} is imported by the panel but neither copied nor bundled by scripts/build-kip.ts`).toBe(true);
    }
  });

  it("the Photo modal has the button, and the bench loads the panel on the first click and not before", () => {
    const modal = bench.slice(bench.indexOf('id="modal-photo"'), bench.indexOf('id="photo-forge-status"'));
    expect(modal).toContain('id="btn-print-photo"');
    expect(bench).not.toMatch(/^import[^;]*kip-photo-print/m); // a static import would make every bench page depend on the generated bundle
    expect(bench).toContain("await import('/kip/kip-photo-print.js?v=10.0')");
    expect(bench).toMatch(/\$el\('btn-print-photo'\)\.addEventListener\('click'/);
  });

  it("the bench hands the panel its own root, publishes it, and lets go of it when it is torn down", () => {
    // the bench also hands it the hook that puts a household library item in Kip's hand (the panel offers one after a scan; docs/specs/household-library-spec.md)
    expect(bench).toContain("createPhotoPrint({ root: benchRoot, onLibraryItem: equipHouseholdItem, ageBand: readAgeBand })");
    expect(bench).toMatch(/const PUBLISHED = \[[^\]]*"kipPhotoPrint"/);
    const teardown = bench.slice(bench.indexOf("function teardown()"), bench.indexOf("function dispose()"));
    expect(teardown).toContain("photoPrint?.dispose?.()");
    expect(bench).toContain("if (disposed) return;"); // a panel that finished loading after the bench was disposed is never made
  });

  it("a panel that cannot load leaves the Photo modal open with a sentence, not a dead button", () => {
    const handler = bench.slice(bench.indexOf("$el('btn-print-photo')"), bench.indexOf("const PUBLISHED"));
    expect(handler).toContain("catch (err)");
    expect(handler).toContain("modalPhoto.classList.add('open')");
    expect(handler).toContain("could not be loaded");
  });
});
