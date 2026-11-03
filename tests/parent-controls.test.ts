// The master switch for the grown-up checks and the play-time limits (docs/specs/parent-controls-off-spec.md, section 4).
// Pure module: src/lib/parentControls.ts. These tests pin the rules that keep it safe: default ON, no way in from a URL or stored data a child can edit,
// the saved settings and the ledger untouched, and the Worker never reading it (the photo-upload gates stay on).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PARENT_PRESETS,
  defaultParentSettings,
  emptyLedgerForDay,
  evaluatePlayTime,
  validateAndMergeParentSettings,
  type ParentSettings,
  type TimeLedgerRow,
} from "../shared/parent-time";
import {
  BYPASS_SESSION_MS,
  LOCAL_PROOF,
  PARENT_CONTROLS_SESSION_KEY,
  bypassGateSession,
  currentParentControls,
  effectiveParentSnapshot,
  parentControlsBanner,
  parentControlsSource,
  readParentControlsInputs,
  resolveParentControls,
  setParentControlsSession,
} from "../src/lib/parentControls";
import { runParentTimeAction, type ParentSnapshot } from "../src/lib/parentTime";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() { return map.size; },
    dump: () => Object.fromEntries(map),
  };
}

const NOW = Date.parse("2026-11-03T19:00:00Z");
const TZ = "UTC";

function snapshotFor(settings: ParentSettings, ledger: TimeLedgerRow, nowMs = NOW): ParentSnapshot {
  return { settings, ledger, status: evaluatePlayTime(nowMs, settings, ledger) } as unknown as ParentSnapshot;
}

function weeknight(): ParentSettings {
  const preset = PARENT_PRESETS.find((p) => p.id === "weeknight")!;
  const merged = validateAndMergeParentSettings(defaultParentSettings(TZ), preset.patch);
  if (!merged.ok) throw new Error(merged.errors.join(", "));
  return merged.settings;
}

/** A limit that has run out: the daily cap spent, so `evaluatePlayTime` answers locked. */
function spentSnapshot(): ParentSnapshot {
  const settings = weeknight();
  const day = "2026-11-03";
  const ledger: TimeLedgerRow = { ...emptyLedgerForDay(day), usedSeconds: 24 * 3600 };
  const snap = snapshotFor(settings, ledger);
  expect(snap.status.locked).toBe(true); // the fixture must be a real locked state, or the tests below prove nothing
  return snap;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the default and the strict reading", () => {
  it("is ON with no inputs at all (this fails if the default ever changes)", () => {
    expect(resolveParentControls({})).toBe("on");
    expect(parentControlsSource({})).toBe("default");
    expect(currentParentControls(false)).toBe("on");
    expect(currentParentControls(true)).toBe("on");
  });

  it("treats anything that is not exactly the string 'off' as on", () => {
    for (const v of ["", "OFF", "Off", " off", "off ", "false", "0", "1", "true", "no", "disabled", null, undefined, true, false, 0, 1, {}, ["off"]]) {
      expect(resolveParentControls({ buildFlag: v, sessionValue: v, demoMode: true }), `value ${JSON.stringify(v)}`).toBe("on");
    }
  });

  it("the build flag turns it off, with or without Demo Mode", () => {
    expect(resolveParentControls({ buildFlag: "off" })).toBe("off");
    expect(resolveParentControls({ buildFlag: "off", demoMode: false })).toBe("off");
    expect(parentControlsSource({ buildFlag: "off", demoMode: true, sessionValue: "off" })).toBe("build"); // the build wins: it cannot be turned back on in the page
  });

  it("the session value counts ONLY while Demo Mode is on", () => {
    expect(resolveParentControls({ sessionValue: "off", demoMode: true })).toBe("off");
    expect(parentControlsSource({ sessionValue: "off", demoMode: true })).toBe("session");
    expect(resolveParentControls({ sessionValue: "off", demoMode: false })).toBe("on");
    expect(resolveParentControls({ sessionValue: "off" })).toBe("on");
    expect(resolveParentControls({ sessionValue: "off", demoMode: undefined })).toBe("on");
  });
});

describe("where it can and cannot come from", () => {
  it("the address bar, localStorage and a cookie never turn it off", () => {
    const keys = [PARENT_CONTROLS_SESSION_KEY, "parentControls", "parent-controls", "PARENT_CONTROLS", "VITE_PARENT_CONTROLS", "toyforge:demo-mode:v1"];
    const local = memoryStorage(Object.fromEntries(keys.map((k) => [k, "off"])));
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", memoryStorage()); // empty: nothing in THIS tab's session
    vi.stubGlobal("location", { search: "?parentControls=off&PARENT_CONTROLS=off&VITE_PARENT_CONTROLS=off", hash: "#parentControls=off", href: "https://x.test/?parentControls=off" });
    vi.stubGlobal("document", { cookie: "parentControls=off; PARENT_CONTROLS=off" });
    expect(readParentControlsInputs(true)).toEqual({ buildFlag: undefined, sessionValue: undefined, demoMode: true });
    expect(currentParentControls(true)).toBe("on");
    expect(currentParentControls(false)).toBe("on");
  });

  it("sessionStorage does turn it off (Demo Mode on), and a new tab starts on again", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    expect(setParentControlsSession(true)).toBe(true);
    expect(readParentControlsInputs(true).sessionValue).toBe("off");
    expect(currentParentControls(true)).toBe("off");
    expect(currentParentControls(false)).toBe("on"); // Demo Mode switched off ends it

    vi.stubGlobal("sessionStorage", memoryStorage()); // a new tab: a fresh session store
    expect(currentParentControls(true)).toBe("on");
  });

  it("turning it back on removes the value", () => {
    const session = memoryStorage();
    vi.stubGlobal("sessionStorage", session);
    setParentControlsSession(true);
    expect(session.dump()).toEqual({ [PARENT_CONTROLS_SESSION_KEY]: "off" });
    expect(setParentControlsSession(false)).toBe(true);
    expect(session.dump()).toEqual({});
    expect(currentParentControls(true)).toBe("on");
  });

  it("a build with VITE_PARENT_CONTROLS=off reads as off; any other value is on", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubEnv("VITE_PARENT_CONTROLS", "off");
    expect(currentParentControls(false)).toBe("off");
    vi.stubEnv("VITE_PARENT_CONTROLS", "on");
    expect(currentParentControls(false)).toBe("on");
    vi.stubEnv("VITE_PARENT_CONTROLS", "OFF");
    expect(currentParentControls(false)).toBe("on");
  });

  it("storage that throws (private window, blocked site data) means on, and the toggle reports failure", () => {
    const boom = () => { throw new Error("denied"); };
    vi.stubGlobal("sessionStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(currentParentControls(true)).toBe("on");
    expect(setParentControlsSession(true)).toBe(false);
    expect(setParentControlsSession(false)).toBe(false);
    vi.stubGlobal("sessionStorage", undefined);
    expect(currentParentControls(true)).toBe("on");
    expect(setParentControlsSession(true)).toBe(false);
  });
});

describe("what 'off' overrides, and what it leaves alone", () => {
  it("on: the very same snapshot comes back (same reference, still locked)", () => {
    const snap = spentSnapshot();
    expect(effectiveParentSnapshot(snap, "on")).toBe(snap);
    expect(effectiveParentSnapshot(snap, "on").status.locked).toBe(true);
  });

  it("off: a locked ledger reads as never locked, no twilight, no quiet hours", () => {
    const snap = spentSnapshot();
    const eff = effectiveParentSnapshot(snap, "off");
    expect(eff.status.locked).toBe(false);
    expect(eff.status.twilightCue).toBe(false);
    expect(eff.status.inQuietHours).toBe(false);
    expect(eff.status.reason).toBe("disabled");
    expect(eff.status.remainingSeconds).toBeNull();
    // it is the shape evaluatePlayTime itself gives when Play Time is switched off, so every existing consumer already handles it
    const switchedOff = evaluatePlayTime(NOW, { ...snap.settings, enabled: false } as ParentSettings, snap.ledger);
    expect(eff.status.locked).toBe(switchedOff.locked);
    expect(eff.status.reason).toBe(switchedOff.reason);
    expect(eff.status.remainingSeconds).toBe(switchedOff.remainingSeconds);
  });

  it("off: quiet hours and the final-minute twilight are overridden too", () => {
    const quiet = { ...weeknight(), quietHours: { enabled: true, start: "00:00", end: "23:59" } } as ParentSettings;
    const quietSnap = snapshotFor(quiet, emptyLedgerForDay("2026-11-03"));
    expect(quietSnap.status.reason).toBe("quiet_hours");
    expect(effectiveParentSnapshot(quietSnap, "off").status.locked).toBe(false);

    const settings = weeknight();
    const ledger: TimeLedgerRow = { ...emptyLedgerForDay("2026-11-03"), usedSeconds: settings.dailyBaseMinutes * 60 - 30 };
    const dusk = snapshotFor(settings, ledger);
    expect(dusk.status.twilightCue).toBe(true);
    expect(effectiveParentSnapshot(dusk, "off").status.twilightCue).toBe(false);
  });

  it("off: the saved settings and the ledger are byte-for-byte unchanged, and the input is not mutated", () => {
    const snap = spentSnapshot();
    const before = JSON.stringify({ settings: snap.settings, ledger: snap.ledger });
    const statusBefore = JSON.stringify(snap.status);
    const eff = effectiveParentSnapshot(snap, "off");
    expect(JSON.stringify({ settings: eff.settings, ledger: eff.ledger })).toBe(before);
    expect(eff.settings).toBe(snap.settings);
    expect(eff.ledger).toBe(snap.ledger);
    expect(JSON.stringify(snap.status)).toBe(statusBefore); // the original still says locked: only the READ is overridden
    expect(snap.settings.enabled).toBe(true);
  });

  it("off is a read, not a write: the same snapshot read with controls on is locked again, as saved", () => {
    const snap = spentSnapshot();
    effectiveParentSnapshot(snap, "off");
    expect(effectiveParentSnapshot(snap, "on").status.locked).toBe(true);
    expect(effectiveParentSnapshot(snap, "on").status.reason).toBe(snap.status.reason);
  });

  it("a snapshot that already reads as switched off comes back as it is", () => {
    const settings = { ...weeknight(), enabled: false } as ParentSettings;
    const snap = snapshotFor(settings, emptyLedgerForDay("2026-11-03"));
    expect(effectiveParentSnapshot(snap, "off")).toBe(snap);
  });
});

describe("the grown-up question, skipped", () => {
  it("on: no bypass session (the question is asked as usual)", () => {
    expect(bypassGateSession("on", NOW)).toBeNull();
  });

  it("off: a session whose token is the local-only proof, so the Worker is never called with it", () => {
    const s = bypassGateSession("off", NOW);
    expect(s).toEqual({ proofToken: LOCAL_PROOF, expiresAt: NOW + BYPASS_SESSION_MS });
    expect(LOCAL_PROOF).toBe("local-proof"); // the literal GrownUpsSheet.tsx and parentTime.ts already compare against
  });

  it("a bypassed time action changes this device only: no request reaches the Worker", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const fetchSpy = vi.fn(async () => { throw new Error("the Worker must not be called for a bypass session"); });
    vi.stubGlobal("fetch", fetchSpy);
    const session = bypassGateSession("off", NOW)!;
    const res = await runParentTimeAction("grant_five_minutes", session.proofToken);
    expect(res.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the banner", () => {
  it("is absent while on", () => {
    expect(parentControlsBanner("default")).toBeNull();
  });

  it("says so, and offers 'Turn back on' only when the page can do it", () => {
    expect(parentControlsBanner("session")).toEqual({ text: "Grown-up checks and limits are off (demo).", canTurnOn: true, button: "Turn back on" });
    expect(parentControlsBanner("build")?.canTurnOn).toBe(false); // a showcase build has no switch to flip back
  });
});

describe("the photo-upload gates stay on", () => {
  // The Worker is where a child's photo is checked for a real grown-up proof (selfie cloud, room scan). Nothing there may read this switch, under any name.
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
    }
    return out;
  }
  const root = resolve(__dirname, "..");

  it("no Worker, shared or Workshop viewer file reads the switch", () => {
    const hits: string[] = [];
    for (const dir of ["worker", "shared", "parts/kip/viewer"]) {
      for (const f of walk(join(root, dir))) {
        const text = readFileSync(f, "utf8");
        if (/parentControls|PARENT_CONTROLS|parent-controls/.test(text)) hits.push(f.slice(root.length + 1));
      }
    }
    expect(hits).toEqual([]);
  });

  it("the selfie and room-scan routes still ask the Worker for a proof", () => {
    for (const file of ["worker/selfie.ts", "worker/roomScan.ts"]) {
      expect(readFileSync(join(root, file), "utf8"), file).toMatch(/verifyParentProofFromRequest/);
    }
  });
});

beforeEach(() => {
  // every test starts from a clean tab: no leftover session value from an earlier one
  vi.stubGlobal("sessionStorage", memoryStorage());
});
