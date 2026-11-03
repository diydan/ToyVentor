import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// How the text-to-part panel is wired into the Kip page, the menu and the build (the same kind of check as tests/photo-print-wiring.test.ts). These read
// files outside the forge lane (kip-bench.js, kip-menu.js, scripts/build-kip.ts), so a missing or half-moved hook fails here and not somewhere a child finds it.

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
const bench = read("parts/kip/viewer/kip-bench.js");
const menu = read("parts/kip/viewer/kip-menu.js");
const panel = read("parts/kip/viewer/kip-forge-make.js");
const build = read("scripts/build-kip.ts");

describe("the text-to-part panel in the Kip page", () => {
  it("the build copies the panel and bundles its logic from shared/forgeMakeFlow.ts into the file the panel imports", () => {
    expect(build).toContain("viewer/kip-forge-make.js");
    expect(build).toContain("shared/forgeMakeFlow.ts");
    expect(build).toContain("kip-forge-make-core.js");
    for (const m of panel.matchAll(/from\s+['"]\.\/([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)) {
      const copied = build.includes(`viewer/${m[1]}`);
      const generated = m[1] === "kip-forge-make-core.js" || m[1] === "kip-photo-print-core.js";
      expect(copied || generated, `${m[1]} is imported by the panel but neither copied nor bundled by scripts/build-kip.ts`).toBe(true);
    }
  });

  it("the committed bundle and panel copies are what the build would make (a stale copy fails here)", () => {
    const dir = mkdtempSync(join(tmpdir(), "kip-forge-make-core-"));
    try {
      const out = join(dir, "core.js");
      execFileSync(join(__dirname, "..", "node_modules/.bin/esbuild"), [join(__dirname, "..", "shared/forgeMakeFlow.ts"), "--bundle", "--format=esm", "--target=es2022", "--minify", "--legal-comments=none", `--outfile=${out}`], { stdio: "pipe" });
      const built = readFileSync(out);
      expect(built.length).toBeGreaterThan(2_000);
      expect(built.toString("utf8")).not.toContain("Recipe v1"); // the browser bundle carries no prompt text
      expect(Buffer.compare(built, readFileSync(join(__dirname, "..", "public/kip/kip-forge-make-core.js")))).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(read("public/kip/kip-forge-make.js")).toBe(panel);
  });

  it("the Tools menu has the entry, and it opens the panel through the bench's act object", () => {
    expect(menu).toContain("id: 'forge-make'");
    expect(menu).toContain("act.openForgeMake()");
    expect(bench).toMatch(/openPhoto: openPhotoModal,\s+openForgeMake,/);
  });

  it("the bench loads the panel on the first click and not before, hands it its own root and the wear hook, publishes it and lets go of it", () => {
    expect(bench).not.toMatch(/^import[^;]*kip-forge-make/m); // a static import would make every bench page depend on the generated bundle
    expect(bench).toContain("await import('/kip/kip-forge-make.js?v=10.0')");
    expect(bench).toContain("createForgeMake({ root: benchRoot, onWear: equipForgePart, onReadyMade: equipReadyMade, downloads: forgeFilesOn })"); // the panel's own files have their own exit (forgeFilesOn), not the photo's (downloadsOn)
    expect(bench).toMatch(/const PUBLISHED = \[[^\]]*"kipForgeMake"/);
    const teardown = bench.slice(bench.indexOf("function teardown()"), bench.indexOf("function dispose()"));
    expect(teardown).toContain("forgeMake?.dispose?.()");
    expect(bench).toContain("if (disposed) return;"); // a panel that finished loading after the bench was disposed is never made
  });

  it("a panel that cannot load leaves a sentence, not a dead menu entry", () => {
    const handler = bench.slice(bench.indexOf("async function openForgeMake()"), bench.indexOf("// The way back from the photo's colours"));
    expect(handler).toContain("catch (err)");
    expect(handler).toContain("could not be loaded");
  });

  it("Wear it puts the first look into the custom crown or head container, only for those two slots, and never throws", () => {
    const fn = bench.slice(bench.indexOf("async function equipForgePart("), bench.indexOf("// The text-to-part panel (F1"));
    expect(fn).toContain("slot !== 'crown' && slot !== 'head'");
    expect(fn).toContain("gltfLoader.parseAsync");
    expect(fn).toContain("customCrownContainer.add(group)");
    expect(fn).toContain("customHeadContainer.add(group)");
    expect(fn).toContain("setCrownMode('custom')");
    expect(fn).toContain("setHeadMode('custom')");
    expect(fn).toContain("catch (err)");
    expect(fn).not.toContain("scadMesh"); // the GLB is already y-up; scadMesh would turn it on its side
    expect(fn).toContain("group.scale.setScalar(1000)"); // and it is in metres: drawn unscaled it is 1000 times too small to see
  });

  it("the fallback wears a ready-made hat or head through the bench's own setters, only for ids the wardrobe has, and never throws", () => {
    const fn = bench.slice(bench.indexOf("function equipReadyMade("), bench.indexOf("// The text-to-part panel (F1"));
    expect(fn).toContain("HAT_OPTIONS.some((h) => h.id === id)");
    expect(fn).toContain("WARDROBE_HEADS.some((h) => h.id === id)");
    expect(fn).toContain("setCrownMode(id)");
    expect(fn).toContain("setHeadMode(id)");
    expect(fn).toContain("catch (err)");
    expect(bench).toMatch(/^\s*WARDROBE_HEADS,/m); // the bench already imports the list it checks against
    // the panel offers it only when the wish could not be made (not for a refusal), and only when the page gave it a way to wear one
    expect(panel).toContain("flow.nearestReadyMade(text, slot)");
    expect(panel).toContain("['unavailable', 'no_recipe', 'too_many_waits'].includes(r.reason)");
    expect(panel).toContain("if (!r.printable) offerReadyMade(state.text, selectedSlot(), true)");
    expect(panel).toContain("if (!onReadyMade || disposed) return;");
  });

  it("the colour choice: swatches from the shared palette, a validated hex into the bench, the spoken name coloured only after a pick, Kip dressed again only when already dressed", () => {
    const fn = bench.slice(bench.indexOf("async function equipForgePart("), bench.indexOf("// The text-to-part panel (F1"));
    expect(fn).toContain("{ slot, glbBase64, name, colorHex }");
    expect(fn).toContain("/^#[0-9a-f]{6}$/i.test(colorHex || '')"); // a bad or missing hex never reaches the material: the custom-part purple instead
    expect(fn).toContain("'#7c4dff'");
    expect(fn).not.toMatch(/mat\.color\.set\('#7c4dff'\);/); // the old hard-coded colour is gone
    expect(panel).toContain("for (const c of flow.FORGE_COLORS)"); // the swatches are the palette's, not a second list
    expect(panel).toContain("colorHex: flow.forgeColorHex(state.colour)");
    expect(panel).toContain("flow.isForgeColorKey(key)"); // a click on anything that is not a swatch word does nothing
    expect(panel).toContain("flow.voiceUrl(useLg, n, state.colourChosen ? state.colour : undefined)"); // the bare noun until the child chooses
    expect(panel).toContain("if (state.worn) wear(currentPart())");
    expect(panel).toContain("if (state.wearing) { state.wearAgain = true; return; }"); // two quick picks never run two dressings at once
    const code = panel.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/colou?r.*(localStorage|sessionStorage)/); // the pick is not stored
  });

  it("leaves out the save button when the bench hands no file out", () => {
    expect(panel).toContain("downloads = true");
    expect(panel).toContain("$.save.hidden = !r.printable || !downloads");
  });

  it("is only buttons and pictures: no innerHTML, no storage writes, no listener on window or document, no cookies", () => {
    const code = panel.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(code).not.toMatch(/localStorage\.setItem|sessionStorage|document\.cookie|indexedDB/);
    expect(code).not.toMatch(/(window|document|win)\.addEventListener/);
    expect(code).toContain("localStorage.getItem"); // the two reads: the device id and the language
  });
});
