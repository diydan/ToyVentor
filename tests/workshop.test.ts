import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as shell from "../parts/kip/viewer/workshop.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { DEFAULT_BENCHES, parseWorkshopSearch, benchSrc, workshopSearch, linkFile } = shell as any;

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

  it("builds the bench's own page URL (the 'open on its own page' link) with the forwarded params, whether or not it already has a query", () => {
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

  it("recognises a bench's link to another bench's page by its file name, wherever the page is served from", () => {
    expect(linkFile("./Kip-Demo.html")).toBe("Kip-Demo.html");
    expect(linkFile("/kip/Kip-Demo.html?vehicle=truck#x")).toBe("Kip-Demo.html");
    expect(linkFile("https://example.com/a/b/Truck-Mockup.html")).toBe("Truck-Mockup.html");
    expect(linkFile("/")).toBe("");
    expect(linkFile(null)).toBe("");
    // every bench is recognised by its own page, and the app's "/" link is not a bench
    for (const b of DEFAULT_BENCHES) expect(linkFile(b.src)).toBe(b.src.split("/").pop());
    expect(DEFAULT_BENCHES.some((b: any) => linkFile(b.src) === linkFile("/"))).toBe(false);
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

  it("points every bench at a module that exists in the viewer folder and exports the mount function the shell calls", () => {
    for (const b of DEFAULT_BENCHES) {
      const m = /^\/kip\/([\w.-]+\.js)(\?v=[\d.]+)?$/.exec(b.module);
      expect(m, `bench ${b.id} module ${b.module}`).not.toBeNull();
      const file = join(root, "parts/kip/viewer", m![1]!);
      expect(existsSync(file), `${m![1]} missing from parts/kip/viewer`).toBe(true);
      expect(readFileSync(file, "utf8"), `${m![1]} must export ${b.mount}`).toMatch(new RegExp(`export function ${b.mount}\\(`));
      expect(read("scripts/build-kip.ts"), `${m![1]} is not copied by build:kip`).toContain(`viewer/${m![1]}`);
    }
  });

  it("ships the Workshop files and the shared stage through build:kip, and the page loads the module the build copies", () => {
    const build = read("scripts/build-kip.ts");
    expect(build).toContain("viewer/Workshop.html");
    expect(build).toContain("viewer/workshop.js");
    expect(build).toContain("viewer/bench-stage.js");
    expect(build).toContain("viewer/kip-session.js");
    expect(read("parts/kip/viewer/Workshop.html")).toMatch(/from '\/kip\/workshop\.js(\?[^']*)?'/);
    // the shell loads the stage and three.js with import(); both must be files the build serves
    const shellSrc = read("parts/kip/viewer/workshop.js");
    expect(shellSrc).toContain("'/kip/bench-stage.js'");
    expect(shellSrc).toContain("'/kip/vendor/three-kip.js'");
    expect(shellSrc).toContain("'/kip/kip-session.js?v=10.0'");
    expect(shellSrc).toContain("sharedKip,");
  });

  it("has no static imports, so Node can load the pure URL functions and the shell can be mounted anywhere (the stage, three.js and the benches arrive with import())", () => {
    expect(read("parts/kip/viewer/workshop.js")).not.toMatch(/^\s*import\s/m);
  });

  it("does not reach into the benches: the shell talks to a bench only through its mount function, the stage and the handle it returns", () => {
    const src = read("parts/kip/viewer/workshop.js");
    expect(src).not.toMatch(/kipMenu|kipDescribe|__KIP_READY__|__TRUCK_READY__/);
  });

  it("paints the stage with the same blueprint gradient the benches use (workshop.js has no imports, so it repeats the string)", () => {
    const look = read("parts/kip/viewer/bench-look.js");
    const gradient = /gradient: '([^']+)'/.exec(look)?.[1];
    expect(gradient, "BLUEPRINT.gradient").toMatch(/^radial-gradient\(/);
    expect(read("parts/kip/viewer/workshop.js")).toContain(`background: ${gradient};`);
    // both benches take their ground from it rather than carrying their own copy
    for (const f of ["kip-bench.js", "truck-bench.js"]) {
      const src = read(`parts/kip/viewer/${f}`);
      expect(src, f).toContain("${BLUEPRINT.gradient}");
      expect(src, f).toMatch(/from '\/kip\/bench-look\.js\?v=10\.0'/);
    }
  });

  it("uses no iframe: a bench is a module on the shared stage (Dan, 2026-11-03)", () => {
    const code = read("parts/kip/viewer/workshop.js").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/iframe/i);
    expect(read("parts/kip/viewer/Workshop.html")).not.toMatch(/<iframe/i);
  });
});
