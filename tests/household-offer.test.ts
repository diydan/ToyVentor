// The household library's offer inside the photo print flow (shared/photoPrintFlow.ts: loadHouseholdCatalog, offerForScan), and the panel's promises
// about it (parts/kip/viewer/kip-photo-print.js). The panel itself is run in a real browser by scripts/e2e-kip-household.mjs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadHouseholdCatalog, offerForScan, type Fetch, type ScanFailureReason, type ScanPhotoResult } from "../shared/photoPrintFlow";
import { parseHouseholdCatalog } from "../shared/householdMatch";
import { PROGRESSION_STORAGE_KEY } from "../src/lib/progression";

const ROOT = join(__dirname, "..");
const catalogText = readFileSync(join(ROOT, "public/kip/household/catalog.json"), "utf8");
const parsed = parseHouseholdCatalog(JSON.parse(catalogText));
if (!parsed.ok) throw new Error(parsed.message);
const catalog = parsed.catalog;
const builtItem = catalog.items.find((i) => i.built)!;
const word = builtItem.words[0]!;
const unbuilt = catalog.items.find((i) => !i.built);

const json = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (fidelity: number, warnings: string[] = []): ScanPhotoResult => ({ ok: true, scan: { fidelity, warnings } as never });
const fail = (reason: ScanFailureReason): ScanPhotoResult => ({ ok: false, reason, message: "x" });

describe("loadHouseholdCatalog", () => {
  it("fetches the catalog file with a plain GET that carries nothing of the child's", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f: Fetch = async (url, init) => {
      calls.push({ url, init });
      return json(catalogText);
    };
    const c = await loadHouseholdCatalog(f);
    expect(c?.items.length).toBe(catalog.items.length);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/kip/household/catalog.json");
    expect(calls[0]!.init).toMatchObject({ method: "GET", credentials: "omit", cache: "no-store" });
    expect(calls[0]!.init?.body).toBeUndefined();
    expect(calls[0]!.init?.headers).toBeUndefined(); // no device id, no proof
  });

  it.each<[string, Fetch]>([
    ["a missing file", async () => json({ error: "no" }, 404)],
    ["a server error", async () => json("oops", 500)],
    ["a reply that is not JSON", async () => json("<html>", 200)],
    ["JSON of the wrong shape", async () => json({ items: "none" })],
    ["a catalog with one bad row", async () => json({ items: [{ id: "BAD" }] })],
    ["a network failure", async () => { throw new TypeError("offline"); }],
    ["a reply whose body cannot be read", async () => ({ ok: true, status: 200, json: async () => { throw new Error("cut"); } }) as unknown as Response],
  ])("%s gives no catalog, and does not throw", async (_name, f) => {
    await expect(loadHouseholdCatalog(f)).resolves.toBeNull();
  });
});

describe("offerForScan", () => {
  it("a good outline with a right word: the item is offered beside the plate", () => {
    const o = offerForScan(catalog, word, ok(0.97));
    expect(o).toMatchObject({ offer: "alongside" });
    expect(o.offer === "alongside" && o.item.id).toBe(builtItem.id);
  });

  it("a scan the child can still see but that is not trusted: the item on its own, saying the outline is poor", () => {
    expect(offerForScan(catalog, word, ok(0.9))).toMatchObject({ offer: "alone", why: "poor_outline" });
    expect(offerForScan(catalog, word, ok(0.99, ["SPLIT_OBJECT"]))).toMatchObject({ offer: "alone", why: "poor_outline" });
  });

  it.each<ScanFailureReason>(["no_match", "no_outline", "outline_failed"])("a photo the helper could not trace (%s) with a right word: the item on its own", (reason) => {
    expect(offerForScan(catalog, word, fail(reason))).toMatchObject({ offer: "alone", why: "no_outline" });
  });

  it.each<ScanFailureReason>(["invalid_input", "offline", "slow_down", "too_large", "helper_off", "busy"])("a failure that is not about the photo (%s) offers nothing", (reason) => {
    expect(offerForScan(catalog, word, fail(reason))).toEqual({ offer: "none", reason: "scan_not_run" });
  });

  it("a wrong word offers nothing, whatever the scan did", () => {
    for (const s of [ok(0.99), ok(0.5), fail("no_match"), fail("outline_failed")]) {
      expect(offerForScan(catalog, "zzzz", s).offer).toBe("none");
      expect(offerForScan(catalog, "", s).offer).toBe("none");
    }
  });

  it("an item that is not built is never offered, even for its own word", () => {
    if (!unbuilt) return; // the library is complete: nothing to refuse
    for (const s of [ok(0.99), fail("no_match")]) expect(offerForScan(catalog, unbuilt.words[0]!, s)).toMatchObject({ offer: "none", reason: "not_built" });
  });
});

describe("offerForScan with the child's age band", () => {
  const aged = (() => {
    const r = parseHouseholdCatalog({
      items: [
        { id: "ball", label: "Ball", words: ["ball"], tags: [], propMm: 90, built: true, glb: "ball.glb", minBand: 0 },
        { id: "hammer", label: "Hammer", words: ["hammer"], tags: ["tool"], propMm: 90, built: true, glb: "hammer.glb", minBand: 2 },
      ],
    });
    if (!r.ok) throw new Error(r.message);
    return r.catalog;
  })();

  it("a held-back item is not offered after any kind of scan the offer reads, and the plate flow is untouched (the answer is just 'none')", () => {
    for (const s of [ok(0.99), ok(0.5), fail("no_match"), fail("no_outline"), fail("outline_failed")]) {
      expect(offerForScan(aged, "hammer", s, 1)).toEqual({ offer: "none", reason: "above_age_band" });
      expect(offerForScan(aged, "hammer", s, 2).offer).not.toBe("none");
      expect(offerForScan(aged, "ball", s, 0).offer).not.toBe("none");
    }
  });

  it("no band is no limit, and a band that is not a band is the strictest", () => {
    expect(offerForScan(aged, "hammer", ok(0.99)).offer).toBe("alongside");
    expect(offerForScan(aged, "hammer", ok(0.99), null).offer).toBe("alongside");
    expect(offerForScan(aged, "hammer", ok(0.99), Number.NaN)).toEqual({ offer: "none", reason: "above_age_band" });
    expect(offerForScan(aged, "ball", ok(0.99), Number.NaN).offer).toBe("alongside");
  });

  it("the real catalog is read for it too: whatever band a built item starts at, one band lower holds it back", () => {
    for (const item of catalog.items.filter((i) => i.built && i.minBand > 0)) {
      const w = item.words.find((x) => (catalog.wordIndex.get(x) ?? []).length === 1)!;
      expect(offerForScan(catalog, w, ok(0.99), item.minBand - 1), item.id).toEqual({ offer: "none", reason: "above_age_band" });
      expect(offerForScan(catalog, w, ok(0.99), item.minBand).offer, item.id).toBe("alongside");
    }
  });
});

describe("where the band comes from", () => {
  const bench = readFileSync(join(ROOT, "parts/kip/viewer/kip-bench.js"), "utf8");
  const panelSrc = readFileSync(join(ROOT, "parts/kip/viewer/kip-photo-print.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the bench reads it from the app's progression record, under the key the app writes it to", () => {
    expect(PROGRESSION_STORAGE_KEY).toBe("toyforge:progression:v1");
    const fn = bench.slice(bench.indexOf("function readAgeBand()"), bench.indexOf("// How a household item is shown"));
    expect(fn).toContain(`localStorage.getItem('${PROGRESSION_STORAGE_KEY}')`);
    expect(fn).toMatch(/rec\.ageBand|rec && rec\.ageBand/);
    expect(fn).toMatch(/b >= 0 && b <= 5/);
    expect(fn).not.toMatch(/setItem|removeItem/); // it only reads
  });

  it("the panel takes the band from the page, reads no storage for it, and hands it to the library at the moment a scan ends", () => {
    expect(panelSrc).toMatch(/onLibraryItem, ageBand \} = \{\}/);
    expect(panelSrc).toContain("flow.offerForScan(catalog, state.word, scanResult, band)");
    expect([...panelSrc.matchAll(/localStorage/g)]).toHaveLength(1); // still only the device id read
    expect(panelSrc).toMatch(/try \{ band = ageBand\(\); \} catch \{ band = Number\.NaN; \}/); // a band that cannot be read is the strictest
  });
});

describe("the panel's promises about the photo's colours", () => {
  const panelSrc = readFileSync(join(ROOT, "parts/kip/viewer/kip-photo-print.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const benchSrc = readFileSync(join(ROOT, "parts/kip/viewer/kip-bench.js"), "utf8");

  it("a skin is made from an outline and a photo only, never from a word alone, and only when the 3D item is taken", () => {
    const make = panelSrc.slice(panelSrc.indexOf("function makeSkin("), panelSrc.indexOf("async function takeLibraryItem"));
    expect(make).toMatch(/if \(!state\.scan \|\| !state\.photo\) return null;/);
    expect([...panelSrc.matchAll(/makeSkin\(/g)]).toHaveLength(2); // the definition and the one call
    const take = panelSrc.slice(panelSrc.indexOf("async function takeLibraryItem"), panelSrc.indexOf("function declineLibraryItem"));
    expect(take).toContain("skin = makeSkin(o.item)");
    expect(take).toContain("await onLibraryItem(");
    expect(take).toMatch(/\{ skin \}\)/);
  });

  it("the words 'coloured from your photo' are said only when the page says it coloured the item, and the page can only say so if it had a skin", () => {
    expect([...panelSrc.matchAll(/coloured from your photo/g)]).toHaveLength(1);
    expect(panelSrc).toContain("coloured ? ', coloured from your photo' : ''");
    expect(panelSrc).toContain("coloured = ok && skin !== null && Boolean(r && r.coloured);");
    // the line that tells the child the item *can* wear the photo's colours is hidden unless there is an outline to colour from
    expect(panelSrc).toContain("$.offerSkin.hidden = !(state.scan && state.photo);");
  });

  it("the bench colours an item only when it was handed a skin, tells the panel whether it did, and keeps the chip in step with the hand", () => {
    const eq = benchSrc.slice(benchSrc.indexOf("async function equipHouseholdItem"), benchSrc.indexOf("// The way back from the photo's colours"));
    expect(eq).toMatch(/if \(extras && extras\.skin\) \{/);
    expect(eq).toContain("return { ok: true, coloured: skinCtl !== null };");
    expect([...benchSrc.matchAll(/applyHouseholdSkin\(THREE/g)]).toHaveLength(1);
    expect(benchSrc).toMatch(/function updateStatusText\(\) \{\n  syncHouseholdChip\(\);/);
    expect(benchSrc).toMatch(/var householdView = null;/); // var: updateStatusText runs during init, before this part of the file
    expect(benchSrc).toMatch(/householdChip\?\.root\.remove\(\);/);
  });
});

describe("the panel's promises about the offer", () => {
  const panel = readFileSync(join(ROOT, "parts/kip/viewer/kip-photo-print.js"), "utf8");
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("it makes no offer, and never asks for the catalog, unless the page gave it a hook to put the item in Kip's hand", () => {
    const consider = code.slice(code.indexOf("async function considerOffer"), code.indexOf("async function takeLibraryItem"));
    expect(consider).toMatch(/typeof onLibraryItem !== 'function'\) return;/);
    expect(consider.indexOf("typeof onLibraryItem")).toBeLessThan(consider.indexOf("loadCatalog()"));
    expect(code.match(/loadCatalog\(\)/g)).toHaveLength(2); // its definition's call site and the one in considerOffer
  });

  it("nothing is equipped except from a button: the hook is called in one place, from the take handler, and that is only wired to the buttons", () => {
    expect([...code.matchAll(/onLibraryItem\(/g)]).toHaveLength(1);
    const take = code.slice(code.indexOf("async function takeLibraryItem"), code.indexOf("function declineLibraryItem"));
    expect(take).toContain("await onLibraryItem(");
    expect(code).toMatch(/\$\.offerTake\.addEventListener\('click', \(\) => takeLibraryItem\(false\)\)/);
    expect(code).toMatch(/\$\.offerBoth\.addEventListener\('click', \(\) => takeLibraryItem\(true\)\)/);
    expect(code.match(/takeLibraryItem\(/g)).toHaveLength(3); // the definition and the two buttons
  });

  it("the offer's words are set as text, and come from the flow module's sentence", () => {
    expect(code).toContain("$.offerText.textContent = flow.offerSentence(o)");
    expect(code).not.toMatch(/offerText\.(innerHTML|insertAdjacentHTML)/);
  });
});
