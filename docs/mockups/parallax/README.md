# Parallax backdrops mockup

Interactive Three.js mockup for `docs/specs/parallax-backdrops-spec.md` (draft, not implemented in the game).

Run: `sh docs/mockups/parallax/serve.sh`, then open `http://127.0.0.1:8765/index.html`.

- `?theme=night|day` — garden with two image backdrop layers (`far-night.png` / `far-day.png` + `mid-garden.png`).
- `?theme=room|library|workshop|desk|toyroom` — the Toy Room technique: no backdrop images, a flat wall on the ground line plus chunky clear-coated 3D props.
- Other URL params: `cam`, `hz`, `explode`, `motion=0`, `speed=full|slow|none`, `images=1`, `layers=far,mid`, `clean=1`, `pathw`, `far`, `mid`.

Art: `far-garden.png` and `mid-garden.png` are the generated source images. `far-night.png` and `far-day.png` are derived from `far-garden.png` by `make_far_night.py` and `make_far_day.py` (`python3 make_far_night.py far-garden.png far-night.png`; needs numpy and Pillow). All indoor art is drawn in code.

`three.module.js` and `three.core.js` are copied from `node_modules` by `serve.sh` and are git-ignored.
