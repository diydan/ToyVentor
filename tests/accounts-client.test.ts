// The browser's side of the accounts routes (src/lib/accountsClient.ts): the sign-in token in the address, the sentences for every failure, and the calls it makes.
import { describe, expect, it } from "vitest";
import { PROFILE_CHANGED_EVENT, createAccountsClient, describeFailure, deviceIsClaimed, looksLikeEmail, offerChild, playAsPlan, profileFromChild, signinTokenFromSearch, withoutSignin } from "../src/lib/accountsClient";

const TOKEN = "A".repeat(43);
const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function client(answer: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const c = createAccountsClient((async (path: string, init: RequestInit) => { calls.push({ method: String(init.method), path, body: init.body ? JSON.parse(String(init.body)) : undefined }); return answer(path, init); }) as unknown as typeof fetch);
  return { c, calls };
}

describe("the sign-in token in the address", () => {
  it("is read only when it has the Worker's shape", () => {
    expect(signinTokenFromSearch(`?signin=${TOKEN}`)).toBe(TOKEN);
    expect(signinTokenFromSearch(`?title=0&signin=${TOKEN}&x=1`)).toBe(TOKEN);
    for (const bad of ["", "?signin=", "?signin=short", `?signin=${"A".repeat(129)}`, `?signin=${TOKEN}%20x`, "?signin=<script>alert(1)</script>aaaaaaaaaaaaaaaaaaaa", "?other=1"]) expect(signinTokenFromSearch(bad), bad).toBeNull();
  });
  it("is removed from the address and nothing else is", () => {
    expect(withoutSignin(`?signin=${TOKEN}`)).toBe("");
    expect(withoutSignin(`?title=0&signin=${TOKEN}&x=1`)).toBe("?title=0&x=1");
    expect(withoutSignin("?title=0")).toBe("?title=0");
    expect(withoutSignin("")).toBe("");
  });
});

describe("the sentences", () => {
  it("one for each thing that goes wrong, and never a status code or the Worker's own words", () => {
    const all = [[0, undefined], [404, "accounts are off"], [503, "email is not set up"], [429, "too many requests"], [502, "could not send the email"], [401, "sign in first"], [400, "this link is not valid any more"], [409, "a family has at most 6 children"], [409, "that device already belongs to a family"], [422, "an email address and a role (parent or self) are needed"], [500, "boom"]] as const;
    const said = all.map(([s, e]) => describeFailure(s, e));
    expect(new Set(said).size).toBe(said.length); // every case reads differently
    for (const [i, line] of said.entries()) { expect(line, String(all[i])).not.toMatch(/\b(40\d|50\d|42\d|429|json|sql|undefined|null)\b/i); expect(line.endsWith(".")).toBe(true); }
    expect(describeFailure(409, "that device already belongs to a family")).toMatch(/another family/);
    expect(describeFailure(409, "a family has at most 6 children")).toMatch(/6 children/);
  });
  it("a plain 404 is not 'accounts are off' (a missing route is just trouble)", () => {
    expect(describeFailure(404, "not found")).toBe("Something went wrong. Please try again.");
  });
});

describe("looksLikeEmail", () => {
  it("accepts an address and refuses what cannot be one", () => {
    for (const ok of ["a@b.co", " mum@example.com ", "sam.o'reilly+toys@mail.example.org"]) expect(looksLikeEmail(ok), ok).toBe(true);
    for (const bad of ["", "nope", "a@b", "a b@c.de", "@b.co", "a@.co", "a@b.c"]) expect(looksLikeEmail(bad), bad).toBe(false);
  });
});

describe("the calls", () => {
  it("standing: off when the routes are off, signed out on 401, signed in with the family, trouble when the network fails", async () => {
    expect(await client(() => reply(404, { error: "accounts are off" })).c.standing()).toEqual({ kind: "off" });
    expect(await client(() => reply(401, { error: "sign in first" })).c.standing()).toEqual({ kind: "signed-out" });
    const me = { family: { id: "f_1" }, parent: { id: "p_1", role: "parent" }, children: [], devices: [] };
    expect(await client(() => reply(200, me)).c.standing()).toEqual({ kind: "signed-in", me });
    const down = createAccountsClient((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch);
    expect(await down.standing()).toEqual({ kind: "trouble", problem: describeFailure(0) });
  });
  it("startLogin sends the trimmed address and the role, and says what went wrong in words", async () => {
    const { c, calls } = client(() => reply(202, { ok: true }));
    expect((await c.startLogin("  mum@example.com ", "parent")).ok).toBe(true);
    expect(calls).toEqual([{ method: "POST", path: "/api/account/login/start", body: { email: "mum@example.com", role: "parent" } }]);
    const limited = await client(() => reply(429, { error: "too many requests" })).c.startLogin("a@b.co", "parent");
    expect(limited).toMatchObject({ ok: false, status: 429, problem: "Too many tries. Please wait an hour and try again." });
  });
  it("verify, addChild, claimDevice, signOut and deleteFamily hit the right routes with the right bodies", async () => {
    const { c, calls } = client(() => reply(200, { ok: true }));
    await c.verify(TOKEN);
    await c.addChild({ firstName: "Mia", favourites: { colour: "blue", fruit: "apple", animal: "elephant" }, under13: true });
    await c.claimDevice("d".repeat(36));
    await c.signOut();
    await c.deleteFamily();
    expect(calls.map((x) => `${x.method} ${x.path}`)).toEqual(["POST /api/account/login/verify", "POST /api/account/children", "POST /api/account/claim-device", "POST /api/account/logout", "DELETE /api/account"]);
    expect(calls[0]!.body).toEqual({ token: TOKEN });
    expect(calls[1]!.body).toEqual({ firstName: "Mia", favourites: { colour: "blue", fruit: "apple", animal: "elephant" }, under13: true });
    expect(calls[2]!.body).toEqual({ deviceId: "d".repeat(36) });
    expect(calls[4]!.body).toBeUndefined();
  });
  it("a spent link reads as 'not valid any more', and an answer that is not JSON does not crash", async () => {
    const r = await client(() => reply(400, { error: "this link is not valid any more" })).c.verify(TOKEN);
    expect(r).toMatchObject({ ok: false, problem: "This link is not valid any more. Ask for a new one." });
    const odd = await client(() => new Response("<html>bad gateway</html>", { status: 502 })).c.startLogin("a@b.co", "parent");
    expect(odd).toMatchObject({ ok: false, status: 502, problem: "The email could not be sent. Please try again in a minute." });
  });
});

describe("what the signed-in screen offers", () => {
  const me = (names: string[], devices: string[] = []) => ({ family: { id: "f" }, parent: { id: "p", role: "parent" as const }, children: names.map((n, i) => ({ id: `c${i}`, firstName: n, favourites: { colour: "blue", fruit: "apple", animal: "elephant" }, under13: true })), devices });
  const profile = { version: 1 as const, kidName: "Mia", parentName: "Sam", under13: true, favourites: { colour: "blue", fruit: "apple", animal: "elephant" }, songConsent: true, createdAt: "2026-11-05T00:00:00Z" };
  it("offers the saved player once, when there is room, never twice", () => {
    expect(offerChild(profile, me([]))).toEqual({ firstName: "Mia", favourites: profile.favourites, under13: true });
    expect(offerChild(profile, me(["mia"]))).toBeNull();
    expect(offerChild(profile, me(["A", "B", "C", "D", "E", "F"]))).toBeNull();
    expect(offerChild(null, me([]))).toBeNull();
  });
  it("knows whether this device is the family's", () => {
    expect(deviceIsClaimed(me([], ["dev-1"]), "dev-1")).toBe(true);
    expect(deviceIsClaimed(me([], ["dev-1"]), "dev-2")).toBe(false);
  });
});

describe("Play as: a family's child becomes this device's player", () => {
  const child = (over: Partial<{ firstName: string; under13: boolean; favourites: { colour: string; fruit: string; animal: string } }> = {}) => ({ id: "c1", firstName: "Mia", favourites: { colour: "blue", fruit: "apple", animal: "elephant" }, under13: true, ...over });
  const local = (over: Record<string, unknown> = {}) => ({ version: 1 as const, kidName: "Mia", parentName: "Sam", under13: true, favourites: { colour: "blue", fruit: "apple", animal: "elephant" }, songConsent: true, createdAt: "2026-11-04T00:00:00Z", ...over });
  const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

  it("the profile is the child's name, favourites and age band, with NO song consent and a placeholder grown-up for the under-13s", () => {
    const p = profileFromChild(child(), "2026-11-05T00:00:00Z")!;
    expect(p).toEqual({ version: 1, kidName: "Mia", parentName: "Grown-up", under13: true, favourites: { colour: "blue", fruit: "apple", animal: "elephant" }, songConsent: false, createdAt: "2026-11-05T00:00:00Z" });
    expect(profileFromChild(child({ under13: false }), "t")!.parentName).toBe("");
    expect(profileFromChild(child({ under13: false }), "t")!.songConsent).toBe(false);
  });
  it("the saved profile is one the app reads back (the title greets by it), through the same store the app uses", async () => {
    const { saveProfile, readProfile } = await import("../src/lib/newPlayer");
    const st = store();
    expect(saveProfile(st, profileFromChild(child({ firstName: "Zoë" }), "2026-11-05T00:00:00Z")!)).toBe(true);
    expect(readProfile(st)).toMatchObject({ kidName: "Zoë", songConsent: false, under13: true });
  });
  it("a child that would not pass the setup's rules is refused instead of written (a digit, a bad pick)", () => {
    expect(profileFromChild(child({ firstName: "Mia2" }), "t")).toBeNull();
    expect(profileFromChild(child({ firstName: "" }), "t")).toBeNull();
    expect(profileFromChild(child({ favourites: { colour: "blue", fruit: "<b>", animal: "elephant" } }), "t")).toBeNull();
    expect(profileFromChild(child({ firstName: "A".repeat(21) }), "t")).toBeNull();
  });
  it("the plan: nobody here: set; the same child: already; the same child with other picks: set; somebody else: confirm, naming them", () => {
    expect(playAsPlan(null, child())).toEqual({ kind: "set" });
    expect(playAsPlan(local(), child())).toEqual({ kind: "already" });
    expect(playAsPlan(local({ kidName: "MIA" }), child())).toEqual({ kind: "already" });
    expect(playAsPlan(local({ favourites: { colour: "red", fruit: "apple", animal: "elephant" } }), child())).toEqual({ kind: "set" });
    expect(playAsPlan(local({ under13: false }), child())).toEqual({ kind: "set" });
    expect(playAsPlan(local({ kidName: "Sam" }), child())).toEqual({ kind: "confirm", current: "Sam" });
  });
  it("the change event has a name the page and the panel share", () => {
    expect(PROFILE_CHANGED_EVENT).toBe("tv-profile-changed");
  });
});
