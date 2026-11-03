import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
// Since Workshop stage 4a the Truck page is a loader; its markup, style and script live in truck-bench.js.
const source = readFileSync(join(root, "parts/kip/viewer/truck-bench.js"), "utf8");

function cssBlock(selector: string) {
  const start = source.indexOf(selector);
  expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

describe("Truck left control menu", () => {
  it("docks the controls at the left like the Kip Demo panel", () => {
    const dock = cssBlock(".dock {");
    expect(source).toContain('<aside class="dock" id="truck-dock" aria-label="Truck controls">');
    expect(dock).toContain("left: 14px");
    expect(dock).toContain("top: 72px");
    expect(dock).toContain("bottom: 40px");
    expect(dock).toContain("width: 288px");
    expect(dock).not.toContain("left: 50%");
    expect(dock).not.toContain("translateX(-50%)");
  });

  it("keeps a phone drawer closed behind an accessible toggle", () => {
    expect(source).toContain('id="truck-menu-toggle"');
    expect(source).toContain('aria-controls="truck-dock"');
    expect(source).toContain('aria-expanded="false"');
    expect(source).toContain("&.truck-menu-open .dock");
    expect(source).toContain("transform: translateX(-105%)");
    expect(source).toContain("function setTruckMenu(open");
    expect(source).toMatch(/truckMenuToggle\.setAttribute\('aria-expanded', String\((?:open|isOpen)\)\)/);
  });

  it("keeps the served Truck page and bench module byte-identical to their sources (run npm run build:kip)", () => {
    for (const f of ["Truck-Mockup.html", "truck-bench.js", "bench-lifecycle.js"]) {
      expect(readFileSync(join(root, "public/kip", f), "utf8"), `public/kip/${f} drifted from parts/kip/viewer/${f}`).toBe(
        readFileSync(join(root, "parts/kip/viewer", f), "utf8"),
      );
    }
  });
});
