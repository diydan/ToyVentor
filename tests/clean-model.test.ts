import { describe, expect, it } from "vitest";
import { CWHY, CFIT } from "../src/features/game/world/runtime/catalog";
import {
  CLEAN_FIT,
  CLEAN_MESSES,
  CLEAN_SHAPES,
  CLEAN_TOOLS,
  SOAP_WINDOWS,
  cleanPlan,
  messOffset,
  rowHalfWidth,
  messParams,
  soapStep,
  widenSoap,
} from "../src/features/game/world/runtime/cleanModel";
import { CLEAN_PROMPT_LINES, CLEAN_WRONG_LINES, SOAP_FIRST, SOAP_HIGH, SOAP_LOW } from "../src/features/game/world/runtime/cleanLines";
import { MESS_PROMPT_LINES } from "../src/features/game/world/runtime/messLines";
import { SCRUB_TOOLS, validateScrub, scrubBandParams } from "../src/features/game/world/runtime/scrub";

describe("the tool rules are the Clean mission's own", () => {
  it("CLEAN_FIT equals CFIT", () => {
    expect({ ...CLEAN_FIT }).toEqual({ ...CFIT });
  });
  it("the wrong-tool lines equal CWHY word for word, so the mission and the level teach the same thing", () => {
    expect({ ...CLEAN_WRONG_LINES }).toEqual({ ...CWHY });
  });
  it("there is a line for every wrong pairing of the three tools and three messes, and none for the right ones", () => {
    for (const mess of CLEAN_MESSES) for (const tool of CLEAN_TOOLS) {
      const key = `${tool}>${mess}`;
      if (CLEAN_FIT[mess] === tool) expect(CLEAN_WRONG_LINES[key], key).toBeUndefined();
      else expect(CLEAN_WRONG_LINES[key], key).toMatch(/^[A-Za-z0-9][\x20-\x7E]*[.!?]$/);
    }
  });
  it("every tool the level offers is a scrub tool", () => {
    for (const t of CLEAN_TOOLS) expect(SCRUB_TOOLS).toContain(t);
  });
});

describe("closed-list lines", () => {
  it("are plain sentences of the shape the closed list requires, each once, and none repeats a mess line", () => {
    expect(new Set(CLEAN_PROMPT_LINES).size).toBe(CLEAN_PROMPT_LINES.length);
    expect(CLEAN_PROMPT_LINES.length).toBe(9);
    for (const l of CLEAN_PROMPT_LINES) {
      expect(l).toMatch(/^[A-Za-z0-9][\x20-\x7E]*[.!?]$/);
      expect(MESS_PROMPT_LINES).not.toContain(l);
    }
    for (const l of [SOAP_FIRST, SOAP_LOW, SOAP_HIGH]) expect(CLEAN_PROMPT_LINES).toContain(l);
  });
});

describe("the band table", () => {
  it("bands 0 and 1: one mess (never jam), the right tool already in hand, no soap", () => {
    for (const band of [0, 1]) for (let start = 0; start < 6; start++) {
      const p = cleanPlan(band, start);
      expect(p.messes.length).toBe(1);
      expect(p.messes[0]).not.toBe("jam");
      expect(p.toolInHand).toBe(true);
      expect(p.soap).toBe(false);
      expect(p.soapWindow).toBeNull();
    }
  });
  it("it alternates crumbs and puddle so playing again is not the same game", () => {
    expect(cleanPlan(0, 0).messes).toEqual(["crumbs"]);
    expect(cleanPlan(0, 1).messes).toEqual(["puddle"]);
    expect(cleanPlan(0, 2).messes).toEqual(["crumbs"]);
  });
  it("band 2: two different messes with a tool to choose; soap is one tap when jam is there", () => {
    for (let start = 0; start < 6; start++) {
      const p = cleanPlan(2, start);
      expect(p.messes.length).toBe(2);
      expect(new Set(p.messes).size).toBe(2);
      expect(p.toolInHand).toBe(false);
      expect(p.soap).toBe(p.messes.includes("jam"));
      expect(p.soapWindow).toBeNull();
    }
  });
  it("band 3 up: all three messes, the soap window of the mission, tiers 1 to 3 at bands 3 to 5", () => {
    for (const band of [3, 4, 5]) {
      const p = cleanPlan(band);
      expect([...p.messes].sort()).toEqual([...CLEAN_MESSES].sort());
      expect(p.soap).toBe(true);
      expect(p.soapWindow).toEqual(SOAP_WINDOWS[band - 3]);
    }
    expect(SOAP_WINDOWS).toEqual([[2, 3], [2, 2], [3, 3]]);
  });
  it("coverage by band is the spec's: tap-clears for 0 and 1, 50% at band 2, 70% from band 3", () => {
    expect(messParams("puddle", 0).tapClears).toBe(true);
    expect(messParams("puddle", 1).tapClears).toBe(true);
    expect(messParams("puddle", 2).coverage).toBe(0.5);
    expect(messParams("puddle", 3).coverage).toBe(0.7);
  });
  it("a bad band or start reads as the youngest and the first", () => {
    expect(cleanPlan(-4, NaN)).toEqual(cleanPlan(0, 0));
    expect(cleanPlan(99).band).toBe(5);
  });
});

describe("mess parameters", () => {
  it("every mess at every band is a valid scrub, needing the tool that fits it", () => {
    for (const kind of CLEAN_MESSES) for (let band = 0; band <= 5; band++) {
      const p = messParams(kind, band);
      expect(validateScrub(p), `${kind} band ${band}`).toEqual([]);
      expect(p.tool).toBe(CLEAN_FIT[kind]);
      expect(p.brush).toBeCloseTo(scrubBandParams(band, CLEAN_SHAPES[kind].brush).brush);
    }
  });
  it("crumbs are a scatter, the puddle and the jam are blobs", () => {
    expect(messParams("crumbs", 3).shape).toBe("scatter");
    expect(messParams("puddle", 3).shape).toBe("blob");
    expect(messParams("jam", 3).shape).toBe("blob");
  });
});

describe("the soap step", () => {
  it("with no window one scoop is right", () => {
    expect(soapStep(0, null)).toBe("low");
    expect(soapStep(1, null)).toBe("ok");
  });
  it("with a window, too few is low and too many is high, like the mission", () => {
    for (const w of SOAP_WINDOWS) {
      expect(soapStep(w[0] - 1, w)).toBe("low");
      expect(soapStep(w[0], w)).toBe("ok");
      expect(soapStep(w[1], w)).toBe("ok");
      expect(soapStep(w[1] + 1, w)).toBe("high");
    }
  });
});

describe("the soap mercy rule", () => {
  it("widens by one scoop each side after every two misses, never below one scoop, and leaves a no-window step alone", () => {
    expect(widenSoap([3, 3], 0)).toEqual([3, 3]);
    expect(widenSoap([3, 3], 1)).toEqual([3, 3]);
    expect(widenSoap([3, 3], 2)).toEqual([2, 4]);
    expect(widenSoap([3, 3], 4)).toEqual([1, 5]);
    expect(widenSoap([2, 2], 100)![0]).toBe(1);
    expect(widenSoap(null, 9)).toBeNull();
  });
  it("so every window in the table can be hit by a child who just keeps adding and mixing", () => {
    for (const w of SOAP_WINDOWS) {
      let misses = 0, ok = false;
      for (let tries = 0; tries < 12 && !ok; tries++) {
        ok = soapStep(1, widenSoap(w, misses)) === "ok" || soapStep(2, widenSoap(w, misses)) === "ok";
        if (!ok) misses++;
      }
      expect(ok).toBe(true);
    }
  });
});

describe("layout", () => {
  it("centres the row on the anchor", () => {
    for (const n of [1, 2, 3]) {
      const xs = Array.from({ length: n }, (_, i) => messOffset(i, n).x);
      expect(xs.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
    }
  });
  it("keeps every pair of messes of every plan clear of each other, with room to brush", () => {
    for (let band = 0; band <= 5; band++) for (let start = 0; start < 6; start++) {
      const { messes } = cleanPlan(band, start);
      for (let a = 0; a < messes.length; a++) for (let b = a + 1; b < messes.length; b++) {
        const A = CLEAN_SHAPES[messes[a]!], B = CLEAN_SHAPES[messes[b]!];
        const oa = messOffset(a, messes.length), ob = messOffset(b, messes.length);
        const gapX = Math.abs(oa.x - ob.x) - (A.width + B.width) / 2;
        const gapZ = Math.abs(oa.z - ob.z) - (A.depth + B.depth) / 2;
        expect(Math.max(gapX, gapZ), `band ${band} start ${start}: ${messes[a]} and ${messes[b]}`).toBeGreaterThan(Math.max(A.brush, B.brush));
      }
    }
  });
  it("the row is never wider than 3.6 units, so it fits beside Kip in the 6.3 units a phone held upright shows across the lane", () => {
    for (let band = 0; band <= 5; band++) for (let start = 0; start < 6; start++) expect(rowHalfWidth(cleanPlan(band, start).messes) * 2).toBeLessThanOrEqual(3.6);
  });
});
