#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Extract the Kip Pro (8+) & Snap (3+) body rig out of viewer/Kip-Demo.html into viewer/kip-rig.js, so other pages (Truck-Mockup.html) show the SAME Kip.

Kip-Demo.html is the source of truth for the Kip rig (torso, limbs, hands, boots, Pro pegs, Snap turrets, neck_turret_2x1). Its rig code is inline in the page,
so it cannot be imported directly. This script cuts the verbatim source of `loadSTL`, `scadMesh`, `mats`, `buildKipRig` and `stlNames` out of the demo (by
matching braces, not line numbers), reads the PartSpec hardware list from the demo's `init()`, and wraps them in one factory:

    import { createKipRig } from './kip-rig.js';
    const K = createKipRig({ THREE, STLLoader, mergeVertices, toCreasedNormals, KIP_BUILD_VERSION });
    const { geos, baseParts } = await K.loadGeos();
    const kip = K.buildKipRig(geos, baseParts);          // the same rig object the demo builds

Run after the demo's rig changes:      python3 parts/kip/sync_kip_rig.py
CI / selftest style staleness check:   python3 parts/kip/sync_kip_rig.py --check     (exit 1 when the module is stale)

Nothing in the generated file is edited by hand. If the demo ever imports this module instead, delete this script.
"""
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMO = HERE / "viewer" / "Kip-Demo.html"
OUT = HERE / "viewer" / "kip-rig.js"

# Free identifiers buildKipRig may use besides its parameters and the pieces we extract. Anything else means the demo's rig grew a new
# dependency and the wrapper must be taught about it (the script refuses to write a module that would throw ReferenceError at runtime).
ALLOWED_GLOBALS = {"THREE", "scadMesh", "mats", "geos", "partspec", "Math", "Object", "Array", "Map", "Set", "Number", "String", "JSON", "console",
                   "Float32Array", "Float64Array", "Uint16Array", "Uint32Array", "Int16Array", "Int32Array", "Uint8Array", "Promise", "Symbol", "isNaN"}


def cut_block(src: str, start_pat: str, open_ch: str, close_ch: str, what: str) -> str:
    """Text from the first match of start_pat through the brace/bracket that closes the first `open_ch` after it. String and comment aware."""
    m = re.search(start_pat, src, re.M)
    if not m:
        raise SystemExit(f"sync_kip_rig: cannot find {what} in {DEMO.name} (pattern {start_pat!r})")
    i = src.index(open_ch, m.end() - 1 if src[m.end() - 1] == open_ch else m.end())
    depth, j, n = 0, i, len(src)
    while j < n:
        c = src[j]
        if c in "'\"`":
            q = c
            j += 1
            while j < n and src[j] != q:
                if src[j] == "\\":
                    j += 1
                elif q == "`" and src[j] == "$" and src[j + 1: j + 2] == "{":
                    k, d = j + 2, 1
                    while k < n and d:
                        d += (src[k] == "{") - (src[k] == "}")
                        k += 1
                    j = k - 1
                j += 1
        elif c == "/" and src[j + 1: j + 2] == "/":
            j = src.index("\n", j)
            continue
        elif c == "/" and src[j + 1: j + 2] == "*":
            j = src.index("*/", j) + 1
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                end = j + 1
                if src[end: end + 1] == ";":
                    end += 1
                return src[m.start(): end]
        j += 1
    raise SystemExit(f"sync_kip_rig: unbalanced {open_ch}{close_ch} while cutting {what}")


def partspec_table(src: str):
    """[(name, url, crease)] from the demo's init(): the 13 PartSpec hardware STLs buildKipRig receives as `partspec`."""
    names_m = re.search(r"const \[\s*((?:[A-Za-z_]\w*\s*,\s*)+[A-Za-z_]\w*)\s*\] = partArr;", src)
    if not names_m:
        raise SystemExit("sync_kip_rig: cannot find `const [..] = partArr;` in init()")
    names = [n.strip() for n in names_m.group(1).split(",") if n.strip()]
    block = cut_block(src, r"Promise\.all\(\[\s*\n\s*loadSTL\('/kip/partspec/", "[", "]", "the PartSpec STL list")
    urls = re.findall(r"loadSTL\('(/kip/partspec/[^']+)',\s*(\d+)\)", block)
    if len(urls) != len(names):
        raise SystemExit(f"sync_kip_rig: {len(urls)} PartSpec STLs but {len(names)} destructured names")
    return [(n, u, int(c)) for n, (u, c) in zip(names, urls)]


def build() -> str:
    src = DEMO.read_text(encoding="utf-8")
    load_stl = cut_block(src, r"^async function loadSTL\(", "{", "}", "loadSTL")
    scad_mesh = cut_block(src, r"^function scadMesh\(", "{", "}", "scadMesh")
    mats = cut_block(src, r"^const mats = \{", "{", "}", "mats")
    rig = cut_block(src, r"^function buildKipRig\(", "{", "}", "buildKipRig")
    stl_names = cut_block(src, r"^const stlNames = \[", "[", "]", "stlNames")
    table = partspec_table(src)

    # every free identifier in the extracted rig must be one the wrapper provides
    code = re.sub(r"//[^\n]*", "", rig)
    code = re.sub(r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"", "''", code)
    declared = set(re.findall(r"\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)", code))
    declared |= {n for grp in re.findall(r"\b(?:const|let)\s*\{([^}]*)\}", code) for n in re.findall(r"[A-Za-z_$][\w$]*", grp)}
    declared |= {n for grp in re.findall(r"\(([^()]*)\)\s*(?:=>|\{)", code) for n in re.findall(r"[A-Za-z_$][\w$]*", grp)}
    declared |= {n for n in re.findall(r"\b([A-Za-z_$][\w$]*)\s*=>", code)}
    used = set(re.findall(r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*[.(\[]", code))
    keywords = {"if", "for", "while", "switch", "return", "function", "catch", "typeof", "new", "await", "async", "of", "in", "else", "do", "case", "super"}
    unknown = sorted(n for n in used - declared - ALLOWED_GLOBALS - keywords if n[0].isupper() or n in {"loco", "kip", "scene", "camera", "document", "window"})
    if unknown:
        raise SystemExit(f"sync_kip_rig: buildKipRig now uses {unknown}; add them to the factory arguments (or ALLOWED_GLOBALS if built in).")

    ps_lines = ",\n".join(f"    ['{n}', '{u}', {c}]" for n, u, c in table)
    return f"""// GENERATED by parts/kip/sync_kip_rig.py from viewer/Kip-Demo.html. DO NOT EDIT BY HAND.
// The Kip Pro (8+) & Snap (3+) body rig (torso, limbs, hands, boots, Pro pegs, Snap turrets, neck_turret_2x1) as Kip-Demo.html builds it.
// Refresh:  python3 parts/kip/sync_kip_rig.py        Staleness check:  python3 parts/kip/sync_kip_rig.py --check
export function createKipRig({{ THREE, STLLoader, mergeVertices, toCreasedNormals, KIP_BUILD_VERSION }}) {{
  const stlLoader = new STLLoader();

{load_stl}

{scad_mesh}

{mats}

{rig}

  const STL_NAMES = {stl_names.split('=', 1)[1].strip().rstrip(';')};

  // PartSpec Pro hardware the rig receives as `partspec` (same files and crease angles as the demo's init()).
  const PARTSPEC = [
{ps_lines}
  ];

  async function loadGeos() {{
    const [geosArr, partArr] = await Promise.all([
      Promise.all(STL_NAMES.map(async (n) => [n, await loadSTL(`/kip/stls/${{n}}.stl`, 38)])),
      Promise.all(PARTSPEC.map(([, url, crease]) => loadSTL(url, crease))),
    ]);
    return {{ geos: Object.fromEntries(geosArr), baseParts: Object.fromEntries(PARTSPEC.map(([key], i) => [key, partArr[i]])) }};
  }}

  return {{ loadSTL, scadMesh, mats, buildKipRig, loadGeos, STL_NAMES }};
}}
"""


def main(argv):
    text = build()
    if "--check" in argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print(f"STALE: {OUT.relative_to(HERE.parent.parent)} does not match {DEMO.name}; run parts/kip/sync_kip_rig.py", file=sys.stderr)
            return 1
        print("kip-rig.js is in sync with Kip-Demo.html")
        return 0
    OUT.write_text(text, encoding="utf-8")
    chk = subprocess.run(["node", "--check", str(OUT)], capture_output=True, text=True)
    if chk.returncode != 0:
        print(chk.stderr, file=sys.stderr)
        return 1
    print(f"wrote {OUT.relative_to(HERE.parent.parent)} ({len(text.splitlines())} lines); node --check ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
