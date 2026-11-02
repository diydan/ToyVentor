import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as shell from "../parts/kip/viewer/workshop.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { DEFAULT_BENCHES, parseWorkshopSearch, benchSrc, workshopSearch } = shell as any;

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("workshop shell: URL rules", () => {
  it("opens the first bench when the address names none, or names one that does not exist", () => {
    expect(parseWorkshopSearch("")).toEqual({ id: "kip", known: false, forward: "" });
    expect(parseWorkshopSearch("?bench=nope")).toEqual({ id: "kip", known: false, forward: "" });
    expect(parseWorkshopSearch("?bench=")).toEqual({ id: "kip", known: false, forward: "" });
  });

  it("picks the named bench and forwards every other param to it untouched", () => {
    expect(parseWorkshopSearch("?bench=truck")).toEqual({ id: "truck", known: true, forward: "" });
    expect(parseWorkshopSearch("?bench=truck&driver=snap&head=fox")).toEqual({ id: "truck", known: true, forward: "driver=snap&head=fox" });
    // order does not matter, and an unknown bench still forwards (the params belong to whichever bench shows)
    expect(parseWorkshopSearch("?vehicle=truck&bench=kip").forward).toBe("vehicle=truck");
    expect(parseWorkshopSearch("?bench=nope&cam=front").forward).toBe("cam=front");
  });

  it("keeps encoded values and repeated keys intact when forwarding", () => {
    expect(parseWorkshopSearch("?bench=kip&hat=top%20hat&hat=cap").forward).toBe("hat=top+hat&hat=cap");
  });

  it("builds the bench URL with the forwarded params, whether or not the bench URL already has a query", () => {
    const [kip] = DEFAULT_BENCHES;
    expect(benchSrc(kip)).toBe("/kip/Kip-Demo.html");
    expect(benchSrc(kip, "")).toBe("/kip/Kip-Demo.html");
    expect(benchSrc(kip, "vehicle=truck")).toBe("/kip/Kip-Demo.html?vehicle=truck");
    expect(benchSrc({ id: "x", src: "/kip/x.html?a=1" }, "b=2")).toBe("/kip/x.html?a=1&b=2");
  });

  it("writes the shell's own query as just the bench id", () => {
    expect(workshopSearch("truck")).toBe("?bench=truck");
    expect(workshopSearch("a b")).toBe("?bench=a%20b");
  });
});

describe("workshop shell: benches and build wiring", () => {
  it("lists Kip first and Truck second, with unique ids, and the list cannot be edited by accident", () => {
    expect(DEFAULT_BENCHES.map((b: any) => b.id)).toEqual(["kip", "truck"]);
    expect(new Set(DEFAULT_BENCHES.map((b: any) => b.label)).size).toBe(DEFAULT_BENCHES.length);
    expect(Object.isFrozen(DEFAULT_BENCHES)).toBe(true);
    expect(Object.isFrozen(DEFAULT_BENCHES[0])).toBe(true);
  });

  it("points every bench at a page that exists in the viewer folder (a rename must fail here, not in the browser)", () => {
    for (const b of DEFAULT_BENCHES) {
      const m = /^\/kip\/([\w.-]+\.html)$/.exec(b.src);
      expect(m, `bench ${b.id} src ${b.src}`).not.toBeNull();
      const fname = m![1]!;
      expect(existsSync(join(root, "parts/kip/viewer", fname)), `${fname} missing from parts/kip/viewer`).toBe(true);
    }
  });

  it("ships both Workshop files through build:kip, and the page loads the module the build copies", () => {
    const build = read("scripts/build-kip.ts");
    expect(build).toContain("viewer/Workshop.html");
    expect(build).toContain("viewer/workshop.js");
    expect(read("parts/kip/viewer/Workshop.html")).toMatch(/from '\/kip\/workshop\.js(\?[^']*)?'/);
  });

  it("stays self-contained: the shell imports nothing, so it can be mounted anywhere without a build step", () => {
    expect(read("parts/kip/viewer/workshop.js")).not.toMatch(/^\s*import\s/m);
  });

  it("does not edit the benches: the shell talks to a bench only through its URL and its window", () => {
    const src = read("parts/kip/viewer/workshop.js");
    expect(src).not.toMatch(/kipMenu|kipDescribe|__KIP_READY__|__TRUCK_READY__/);
  });
});
