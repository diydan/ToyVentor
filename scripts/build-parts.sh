#!/usr/bin/env bash
# Regenerate STL files from parts/**/*.scad into generated/stl/.
# GLB conversion for AR/game is NOT wired yet — that's the open tooling
# risk in docs/spec.md (Open questions). This script says so instead of
# pretending: when a converter is chosen it plugs in below.
set -euo pipefail

if ! command -v openscad >/dev/null 2>&1; then
  echo "build-parts: OpenSCAD is not installed, so no STL was generated." >&2
  echo "Install it (e.g. brew install openscad) and re-run: npm run parts" >&2
  exit 2
fi

mkdir -p generated/stl
count=0
# find, not globstar: stock macOS bash 3.2 has no globstar.
while IFS= read -r src; do
  case "$src" in
    parts/profiles/*) continue ;; # library/include files, not parts
  esac
  name="$(basename "$src" .scad)"
  echo "openscad: $src -> generated/stl/$name.stl"
  openscad -o "generated/stl/$name.stl" "$src"
  count=$((count + 1))
done < <(find parts -name '*.scad' | sort)
echo "build-parts: $count STL file(s) in generated/stl/"
echo "build-parts: GLB export not wired yet (see header note)."
