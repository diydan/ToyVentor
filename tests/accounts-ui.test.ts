// The accounts screens (src/features/game/world/AccountPanel.tsx): the Account group in Grown-Ups and the card for the emailed link. They are hidden until the Worker has accounts on, a link is
// traded exactly once, and the token never stays in the address bar. Checked in a real headless Chrome 2026-11-05 with stubbed routes; this pins the wiring that check relied on.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyOnce } from "../src/features/game/world/AccountPanel";
import type { AccountsClient } from "../src/lib/accountsClient";

const W = "../src/features/game/world/";
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panel = read(`${W}AccountPanel.tsx`), sheet = read(`${W}GrownUpsSheet.tsx`), canvas = read(`${W}GameCanvas.tsx`), css = read("../src/index.css");

describe("a link is traded once", () => {
  it("however many times the effect runs, one verify call is made for one token, and every caller gets its answer", async () => {
    let calls = 0;
    const api = { verify: async () => { calls++; return { ok: true as const, data: { ok: true, new: true } }; } } as unknown as AccountsClient;
    const a = verifyOnce(api, "T".repeat(43)), b = verifyOnce(api, "T".repeat(43));
    expect(await a).toEqual(await b);
    expect(calls).toBe(1);
    await verifyOnce(api, "U".repeat(43));
    expect(calls).toBe(2);
  });
});

describe("wiring", () => {
  it("the group draws nothing while accounts are off or unreachable, so a visitor never meets a dead feature", () => {
    expect(panel).toContain('if (!standing || standing.kind === "off" || standing.kind === "trouble") return null;');
  });
  it("deleting the family takes two taps, and sign-out and delete are different buttons", () => {
    expect(panel).toContain("nextForgetTap(armedAt.current, Date.now())");
    expect(panel).toMatch(/<TwoTap label="Delete the family account"[\s\S]{0,220}api\.deleteFamily\(\)/);
    expect(panel).toContain("api.signOut()");
  });
  it("the Grown-Ups sheet shows the group once, after the New player group and before Showcase", () => {
    expect(sheet).toContain('import { AccountGroup } from "./AccountPanel";');
    expect(sheet.split("<AccountGroup />").length - 1).toBe(1);
    expect(sheet.indexOf("data-new-player")).toBeLessThan(sheet.indexOf("<AccountGroup />"));
    expect(sheet.indexOf("<AccountGroup />")).toBeLessThan(sheet.indexOf("Showcase &amp; Developer"));
  });
  it("the page reads the token from the address, takes it out of the address bar at once, and shows the card until it is dismissed", () => {
    expect(canvas).toContain("useState<string | null>(() => { try { return signinTokenFromSearch(window.location.search); }");
    expect(canvas).toContain('window.history.replaceState(null, "", window.location.pathname + withoutSignin(window.location.search) + window.location.hash)');
    expect(canvas).toContain("{signinToken && <SignInLanding token={signinToken} onDone={() => setSigninToken(null)} />}");
  });
  it("the card is a .tv-onb overlay, which the title screen's hide rule exempts (otherwise a link opened on the title would show nothing)", () => {
    expect(panel).toContain('className="tv-onb tv-signin"');
    expect(css).toContain(".tv-host--titled .tv-stage > :not(.tv-stage-canvas-host):not(.tv-title):not(.tv-onb)");
  });
  it("Play as: each child has a row; replacing a different player takes two taps; the profile is written without song consent and the title is told through the window event", () => {
    expect(panel).toContain("plan={playAsPlan(profile, c)}");
    expect(panel).toMatch(/plan\.kind === "confirm" \? <TwoTap label=\{`Play as \$\{child\.firstName\}`\}/);
    expect(panel).toContain("profileFromChild(child, new Date().toISOString())");
    expect(panel).toContain("saveProfile(window.localStorage, made)");
    expect(panel).toContain("window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT))");
    expect(canvas).toContain("window.addEventListener(PROFILE_CHANGED_EVENT, reread);");
    expect(canvas).toContain("window.removeEventListener(PROFILE_CHANGED_EVENT, reread);");
    expect(panel).not.toMatch(/songConsent\s*[:=]\s*true/);
  });
  it("both screens are touched only by the pure client: no storage of the session, no token in a log", () => {
    expect(panel).not.toMatch(/localStorage\.setItem|sessionStorage|console\./);
    expect(read("../src/lib/accountsClient.ts")).not.toMatch(/localStorage|sessionStorage|console\./);
  });
});
