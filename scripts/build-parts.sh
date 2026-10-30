#!/usr/bin/env bash
# Regenerate STL files from parts/scad/**/*.scad into generated/stl/, serve
# them from public/parts-stl/, and convert to GLB in public/parts-glb/
# for the AR/3D viewer (scripts/stl_to_glb.py, stdlib only).
set -euo pipefail

if ! command -v openscad >/dev/null 2>&1; then
  echo "build-parts: OpenSCAD is not installed, so no STL was generated." >&2
  echo "Install it (e.g. brew install openscad) and re-run: npm run parts" >&2
  exit 2
fi

mkdir -p generated/stl public/parts-stl
count=0
# find, not globstar: stock macOS bash 3.2 has no globstar.
while IFS= read -r src; do
  case "$src" in
    parts/scad/profiles/*) continue ;; # library/include files, not parts
  esac
  name="$(basename "$src" .scad)"
  echo "openscad: $src -> generated/stl/$name.stl"
  openscad -o "generated/stl/$name.stl" "$src"
  # The web app serves downloadable STLs from public/ (STL export, spec).
  cp "generated/stl/$name.stl" "public/parts-stl/$name.stl"
  count=$((count + 1))
done < <(find parts/scad -name '*.scad' | sort)
echo "build-parts: $count STL file(s) in generated/stl/"
python3 scripts/stl_to_glb.py generated/stl public/parts-glb
