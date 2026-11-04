// The wish worlds in Create (docs/specs/generated-worlds-spec.md section 0): the action, the snapshot's list, the panel's row and the world.ts hooks. Pinned by behaviour where it is pure (the snapshot builder and
// normaliser) and by text where it is wiring (JSX and the single-line world.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { closedCreateSnapshot, normalizeCreateSnapshot } from "../src/features/game/world/engine";
import { createData } from "../src/features/game/world/runtime/createData";

const root = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(`${root}${p}`, "utf8");
const world = read("src/features/game/world/runtime/world.ts");
const engine = read("src/features/game/world/engine.ts");
const panel = read("src/features/game/world/CreatePanel.tsx");
const base = { busy: false, say: "", inputValue: "", chips: [], themeName: "Garden", spots: [], scenery: [], tip: false, canUndo: false, codeVisible: false, micAvailable: false, recipe: null };
const lookCard = (s: ReturnType<typeof createData>) => s.cards.find((c) => c.title === "Look");

describe("the snapshot carries the wish worlds", () => {
  it("createData passes the list through, and an older caller with none gets an empty list", () => {
    expect(createData({ ...base, wishes: [{ id: "candy-forest", name: "Sugary Garden Grove" }] }).wishes).toEqual([{ id: "candy-forest", name: "Sugary Garden Grove" }]);
    expect(createData(base).wishes).toEqual([]);
  });
  it("normalizeCreateSnapshot keeps well-formed wishes, drops ones with no id or name, and a closed sheet has none", () => {
    const n = normalizeCreateSnapshot({ open: true, wishes: [{ id: "a", name: "Alpha" }, { id: "", name: "No id" }, { id: "b", name: "" }, { id: " c ", name: " Gamma " }] } as never);
    expect(n.wishes.map((w) => w.id)).toEqual(["a", "c"]);
    expect(n.wishes.map((w) => w.name)).toEqual(["Alpha", "Gamma"]);
    expect(normalizeCreateSnapshot({ open: true } as never).wishes).toEqual([]);
    expect(normalizeCreateSnapshot({ open: false, wishes: [{ id: "a", name: "A" }] } as never).wishes).toEqual([]);
    expect(closedCreateSnapshot.wishes).toEqual([]);
  });
});

describe("the wiring", () => {
  it("engine: a `wish:<id>` action reaches the world's crWish hook with the id, and the other actions are untouched", () => {
    expect(engine).toContain('export type CreateAction = "undo" | "keep" | "play" | "code" | "mic" | "unlook" | `wish:${string}`;');
    expect(engine).toContain('else if (typeof action === "string" && action.startsWith("wish:")) api?.crWish?.(action.slice(5));');
    expect(engine).toContain("crWish?: (id: string) => void;");
    expect(engine).toContain('if (action === "undo") api?.crUndo?.();');
  });
  it("the Create panel has a Wish worlds row of buttons that send `wish:<id>` and wait while a make is under way", () => {
    expect(panel).toContain('aria-label="Wish worlds"');
    expect(panel).toContain("onAction(`wish:${wish.id}`)");
    expect(panel).toMatch(/snapshot\.wishes\.map\(\(wish\) => \(\s*<button[\s\S]{0,200}disabled=\{snapshot\.busy\}/);
  });
  it("world.ts: crWish loads the wish world's level as Create's level (with its art registered first), is exposed on the handle and shows in the snapshot", () => {
    expect(world).toContain('import { registerWishArt, registerWishArtForLook, wishCards, wishLevel } from "./wishWorlds";');
    expect(world).toMatch(/function crWish\(id: string\)\{if\(CR\.busy\)return;var L=wishLevel\(id\);if\(!L\)return;registerWishArt\(id\);edPush\(\);ED\.R=L;ED\.sel=null;syncEdInputs\(\);edApply\(\);/);
    expect(world).toContain("crWish:function(id){crWish(id)},");
    expect(world).toContain("wishes:wishCards(),lookName:R&&R.look?String(R.look.name):null,recipe:ED.R});");
  });
  it("world.ts: a refinement keeps the world's look (same base theme), and entering Create with a saved look registers a showcase look's art", () => {
    expect(world).toContain("if(prev&&prev.look&&out.theme===prev.theme)out.look=prev.look;");
    expect(world).toContain("if(R.look&&R.look.id&&!registerWishArtForLook(R.look.id)){var lk=R;ensureLookArt(R.look,defaultStore()).then(function(ok){if(ok&&ED.R===lk)edApply()})}ED.R=R;");
  });
  it("a made level with a look survives the editor's validity check (it only looks at the format, theme, props and spots)", () => {
    expect(world).not.toMatch(/function edValid[^\n]*\.look/);
    expect(read("src/features/game/world/runtime/editor.ts")).toContain("function edValid(R: any): R is LevelDef {return Boolean(R&&R.format===");
  });

  it("a made look is its own labelled card and a name in the snapshot; no look, no card", () => {
    const withLook = createData({ ...base, lookName: "Sugary Garden Grove" });
    expect(lookCard(withLook)).toEqual({ title: "Look", text: "Sugary Garden Grove (AI-made)" });
    expect(withLook.lookName).toBe("Sugary Garden Grove");
    expect(lookCard(createData(base))).toBeUndefined();
    expect(createData(base).lookName).toBeNull();
    expect(normalizeCreateSnapshot({ open: true, lookName: " Frosty Valley " } as never).lookName).toBe("Frosty Valley");
    expect(normalizeCreateSnapshot({ open: true, lookName: null } as never).lookName).toBeNull();
    expect(closedCreateSnapshot.lookName).toBeNull();
  });
  it("the engine routes `unlook` and the panel offers a way to remove an AI-made look only when there is one", () => {
    expect(engine).toContain('else if (action === "unlook") api?.crUnlook?.();');
    expect(engine).toContain("crUnlook?: () => void;");
    expect(panel).toContain("{snapshot.lookName && (");
    expect(panel).toContain('onAction("unlook")');
    expect(panel).toContain("Remove the AI-made look");
  });
  it("world.ts paints a look after a wish makes a world, only through the game's own Worker, never for a refinement, with the friendly limit, and a failure leaves the world as it was", () => {
    expect(world).toContain("notify();crPaint(text,ED.R)}");
    expect(world).toContain('var api=MUSE.url==="/api/muse/spark"?"/api/world":null;if(!api||!R||R.look||CR.busy||');
    expect(world).toContain("add|more|put|remove|delete|take|make it|a few|some");
    expect(world).toContain("var cap=deviceCap(localStorage,Date.now());if(!cap.ok){");
    expect(world).toContain("if(ED.R!==R){notify();return}");                                         // (the sheet was closed while painting: the result is dropped)
    expect(world).toContain("if(r.look.kind!==\"indoor\")registerGeneratedLook(r.look,r.art);ED.R.look=r.look;edApply();");
    expect(world).toContain("else{var say=failureSay(r.status);if(say)crSay=say}");
    expect(world).toContain("crUnlook:function(){crUnlook()},");
    expect(world).toMatch(/function crUnlook\(\)\{if\(CR\.busy\|\|!ED\.R\|\|!ED\.R\.look\)return;var id=ED\.R\.look\.id;forgetGeneratedLook\(id\);/);
  });
  it("the refinement words that skip painting are real refinements and a place wish is not one", () => {
    const skip = /^\s*(add|more|put|remove|delete|take|make it|a few|some)\b/i;
    for (const t of ["add a lantern", "More trees", "put a rock near the tree", "remove the cave", "make it night", "some snowmen"]) expect(skip.test(t), t).toBe(true);
    for (const t of ["a candy forest at sunset", "my pirate bedroom", "snowy mountain with a cave", "an addition of stars"]) expect(skip.test(t), t).toBe(false);
  });
});
