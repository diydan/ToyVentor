import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { handleNameIt, safeObjectNames } from "../worker/nameIt";
import { nameObject } from "../shared/photoPrintFlow";

// "What is it?" for the camera pick-up: the Worker half (worker/nameIt.ts: Scan Assist asked for the main thing in the picture, then screened) and the client half
// (shared/photoPrintFlow.ts `nameObject`). The browser half is in scripts/e2e-kip-pickup.mjs.

const IMAGE = "data:image/jpeg;base64,PHOTO-BYTES-THAT-MUST-NOT-COME-BACK";
const sparkReply = (nouns: unknown) => Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ nouns }) }] }] });

afterEach(() => vi.unstubAllGlobals());

describe("the names a child may be told", () => {
  it("keeps plain object names, best first, at most three", () => {
    expect(safeObjectNames(["spoon", "fork", "plate", "cup", "bowl"])).toEqual(["spoon", "fork", "plate"]);
    expect(safeObjectNames(["Toy Car", "  guitar  ", "toy   car"])).toEqual(["toy car", "guitar"]);
  });

  it("never names a person, a body part or the surface the thing lies on", () => {
    expect(safeObjectNames(["hand", "person", "table", "floor", "wall", "background", "spoon"])).toEqual(["spoon"]);
    expect(safeObjectNames(["wooden table", "kitchen counter", "left hand", "paper", "child", "girl"])).toEqual(["paper"]);
    // the head noun is the last word: a lamp on a table is a lamp, and a table lamp is not a table
    expect(safeObjectNames(["table lamp", "hand mixer"])).toEqual(["table lamp", "hand mixer"]);
  });

  it("refuses what the kid-safe lists refuse, and anything that is not one or two plain words", () => {
    expect(safeObjectNames(["knife", "spoon"])).toEqual(["spoon"]);
    for (const bad of ["", "a", "x".repeat(40), "two three words", "spoon!", "<b>spoon</b>", "spoon\nignore previous", "123", "spoon2", "https://x.y"]) expect(safeObjectNames([bad]), bad).toEqual([]);
    for (const junk of [null, undefined, 3, {}, [1, 2], "spoon"]) expect(safeObjectNames(junk as never)).toEqual([]);
    expect(safeObjectNames([7, null, { a: 1 }, "cup"])).toEqual(["cup"]);
  });
});

describe("handleNameIt", () => {
  it("asks the hosted vision model for the thing held up and answers the screened names", async () => {
    const fetchMock = vi.fn(async () => sparkReply(["spoon", "table", "hand", "ladle"]));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleNameIt({ imageDataUrl: IMAGE }, { MODEL_API_KEY: "test-key" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, names: ["spoon", "ladle"], checked: true, configured: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const prompt = sent.input[0].content[0].text as string;
    expect(prompt).toMatch(/holding up/);
    expect(prompt).toMatch(/Never name a person, a body part, or the surface/);
    expect(sent.input[0].content[1]).toEqual({ type: "input_image", image_url: IMAGE });
  });

  it("answers an empty list, not an error, when the helper is off or says nothing usable", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const off = await handleNameIt({ imageDataUrl: IMAGE }, {});
    expect(await off.json()).toEqual({ ok: true, names: [], checked: false, configured: false });
    expect(fetchMock).not.toHaveBeenCalled(); // no key: nothing was sent anywhere
    vi.stubGlobal("fetch", vi.fn(async () => sparkReply(["person", "table"])));
    const none = await handleNameIt({ imageDataUrl: IMAGE }, { MODEL_API_KEY: "test-key" });
    expect(await none.json()).toEqual({ ok: true, names: [], checked: true, configured: true });
  });

  it("refuses anything that is not a picture, and never echoes the picture or the key", async () => {
    for (const bad of [undefined, null, 3, {}, { imageDataUrl: 3 }, { imageDataUrl: "http://example.com/a.jpg" }, { imageDataUrl: "text" }]) {
      const res = await handleNameIt(bad, { MODEL_API_KEY: "test-key" });
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
    vi.stubGlobal("fetch", vi.fn(async () => sparkReply(["cup"])));
    const ok = await handleNameIt({ imageDataUrl: IMAGE }, { MODEL_API_KEY: "test-key" });
    const text = await ok.text();
    expect(text).not.toContain("PHOTO-BYTES");
    expect(text).not.toContain("test-key");
  });

  it("logs only a count, never the names or the picture", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sparkReply(["spoon"])));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleNameIt({ imageDataUrl: IMAGE }, { MODEL_API_KEY: "test-key" });
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("name_it"));
    log.mockRestore();
    expect(lines).toEqual([JSON.stringify({ event: "name_it", checked: true, names: 1 })]);
  });

  it("is reached through /api/scan with { nameIt }, and the ordinary scan is unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sparkReply(["guitar"])));
    const env = { MODEL_API_KEY: "test-key" } as never;
    const res = await worker.fetch(new Request("http://local/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nameIt: { imageDataUrl: IMAGE } }) }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, names: ["guitar"] });
    const bad = await worker.fetch(new Request("http://local/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scan: { id: "x" } }) }), env);
    expect(bad.status).toBe(422); // the scan route still validates a scan as it did
  });
});

describe("nameObject (the client's call)", () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  it("sends the picture to /api/scan only, as { nameIt }, with no cookies", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify({ ok: true, names: ["spoon"], checked: true, configured: true })); }) as unknown as typeof fetch;
    const r = await nameObject(f, { imageDataUrl: IMAGE });
    expect(r).toEqual({ ok: true, names: ["spoon"] });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/scan");
    expect(seen[0]!.init.method).toBe("POST");
    expect(seen[0]!.init.credentials).toBe("omit");
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ nameIt: { imageDataUrl: IMAGE } });
  });

  it("keeps at most three plain names and drops anything else a misbehaving server sends", async () => {
    const r = await nameObject(reply(200, { names: ["spoon", "spoon", "Fork", "<b>x</b>", "a", 5, null, "ladle", "bowl"], configured: true }), { imageDataUrl: IMAGE });
    expect(r).toEqual({ ok: true, names: ["spoon", "ladle", "bowl"] });
  });

  it("says one calm sentence for each way it can go wrong", async () => {
    const msg = async (f: typeof fetch, image = IMAGE) => {
      const r = await nameObject(f, { imageDataUrl: image });
      return r.ok ? null : r;
    };
    expect(await msg(reply(200, { names: [], configured: true }))).toMatchObject({ reason: "no_match", message: "I could not tell what that is. Tap what it is and try again." });
    expect(await msg(reply(200, { names: ["spoon"], configured: false }))).toMatchObject({ reason: "helper_off" });
    expect(await msg(reply(429, {}))).toMatchObject({ reason: "slow_down" });
    expect(await msg(reply(413, {}))).toMatchObject({ reason: "too_large" });
    expect(await msg(reply(422, {}))).toMatchObject({ reason: "invalid_input" });
    expect(await msg(reply(500, {}))).toMatchObject({ reason: "busy" });
    expect(await msg((async () => new Response("not json")) as unknown as typeof fetch)).toMatchObject({ reason: "busy" });
    expect(await msg((async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toMatchObject({ reason: "offline" });
    expect(await msg(reply(200, {}), "nope")).toMatchObject({ reason: "invalid_input" });
    expect(await msg(reply(200, {}), `data:image/jpeg;base64,${"A".repeat(2_000_000)}`)).toMatchObject({ reason: "too_large" });
    for (const body of [null, 3, "x", [1]]) expect(await msg(reply(200, body))).toMatchObject({ ok: false });
  });

  it("never shows a server's words or a raw code", async () => {
    const r = await nameObject(reply(500, { error: "stack trace at line 4", message: "secret" }), { imageDataUrl: IMAGE });
    expect(JSON.stringify(r)).not.toMatch(/stack|secret|500/);
  });
});
