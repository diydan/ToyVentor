#!/bin/sh
# Serve the parallax-backdrops mockup at http://127.0.0.1:8765/index.html  (see docs/specs/parallax-backdrops-spec.md)
# Uses the repo's own three.js so nothing is vendored. Run from anywhere: sh docs/mockups/parallax/serve.sh
cd "$(dirname "$0")" || exit 1
cp ../../../node_modules/three/build/three.module.js ../../../node_modules/three/build/three.core.js . || { echo "run npm install first"; exit 1; }
echo "open http://127.0.0.1:8765/index.html  (?theme=night|day|room|library|workshop|desk|toyroom)"
exec python3 -m http.server 8765 --bind 127.0.0.1
