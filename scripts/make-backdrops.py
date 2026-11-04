#!/usr/bin/env python3
"""Bake the Garden's parallax backdrop art for the game (docs/specs/parallax-backdrops-spec.md).

Inputs are the approved mockup images in docs/mockups/parallax/; outputs are the game's own web-ready assets in
src/features/game/world/runtime/assets/ (imported by runtime/backdrop.ts, so Vite hashes them and the service worker can cache them for good).

  far : far-night.png (5742 x 760, an opaque band-shaped panorama: moon, stars, hazy hills) -> garden-far-night.webp, 4096 px wide.
        4096 is the widest texture every phone GPU we care about takes; 5742 is not (older devices give a black plane).
  mid : mid-garden.png (1920 x 1280: hills, trees and a house on a black surround) -> garden-mid.webp, a real RGBA cut-out.
        The mockup keyed the black surround to transparency in the browser at load; shipping that would cost a 2.4 MP canvas pass on every
        world load, so it is done here, once, with the same rule: flood-fill the near-black surround from the image border (dark pixels
        INSIDE the art survive), eat two more rings of the dark fringe, crop to the art's bounding box. Then what the browser can't do cheaply:
        the transparent pixels get the colour of the nearest art pixel (so linear filtering never fades to a dark halo) and the alpha edge is
        softened by one pixel (so the silhouette is not jagged on a phone).

The other outdoor worlds (Sky Meadow, Beach, Snow Peak, Junkyard) and the Garden's day band come from `scripts/gen-backdrops.mjs` (raw Muse Image output in docs/mockups/generated-backdrops/worlds/,
the art of record: the service takes no seed). `python3 scripts/make-backdrops.py worlds` bakes those the same way: each far band resized to 4096 px wide, each mid strip keyed off its black
surround into an RGBA cut-out. The Garden's own two files are baked only by the plain command below, so adding a world never touches the approved Garden pixels.

Run from the repo root:   python3 scripts/make-backdrops.py          the Garden (far night + mid)
                          python3 scripts/make-backdrops.py worlds   the other worlds (needs the files gen-backdrops.mjs wrote)
Needs Pillow with WebP and numpy; not `python3 -I`, which hides the user site.
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "mockups", "parallax")
OUT = os.path.join(ROOT, "src", "features", "game", "world", "runtime", "assets")

FAR_WIDTH = 4096
DARK_SEED = 24      # a pixel this dark (max channel) on the border starts the surround
DARK_FRINGE = 80    # a pixel this dark next to the surround is fringe, eaten for two rings


GEN = os.path.join(ROOT, "docs", "mockups", "generated-backdrops")
WORLD_ART = os.path.join(GEN, "worlds")

# (output name, source) for the worlds. The Garden's day band is the approved mockup's generated `far-day.webp`.
WORLD_FARS = [("garden-far-day", os.path.join(GEN, "far-day.webp"))] + [
    (f"{w}-far-{t}", os.path.join(WORLD_ART, f"{w}-far-{t}.webp")) for w in ("sky", "beach", "snow", "junk") for t in ("day", "night")]
WORLD_MIDS = [(f"{w}-mid", os.path.join(WORLD_ART, f"{w}-mid.webp")) for w in ("sky", "beach", "snow", "junk")]


def bake_far(src: str | None = None, name: str = "garden-far-night") -> str:
    im = Image.open(src or os.path.join(SRC, "far-night.png")).convert("RGB")
    w, h = im.size
    out = im.resize((FAR_WIDTH, round(h * FAR_WIDTH / w)), Image.LANCZOS)
    path = os.path.join(OUT, f"{name}.webp")
    out.save(path, "WEBP", quality=84, method=6)
    return f"{path}  {out.size[0]}x{out.size[1]}  {os.path.getsize(path) // 1024} KB"


def surround_mask(rgb: np.ndarray) -> np.ndarray:
    """True where the black surround is: dark pixels connected to the image border (interior darks survive), plus two rings of dark fringe."""
    h, w, _ = rgb.shape
    mx = rgb.max(axis=2)
    # A binary picture for PIL's C flood fill: 255 = dark enough to be surround, 0 = art. Fill the dark region from every dark border pixel.
    # .copy(): Image.fromarray shares the numpy buffer read-only, and PIL's flood fill then silently writes nowhere.
    dark = Image.fromarray(np.where(mx < DARK_SEED, 255, 0).astype(np.uint8)).copy()
    seeds = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    for xy in seeds:
        if dark.getpixel(xy) == 255:
            ImageDraw.floodfill(dark, xy, 128)
    bg = np.asarray(dark) == 128
    for _ in range(2):  # the dark fringe: not yet surround, dark-ish, touching the surround
        near = np.zeros_like(bg)
        near[1:, :] |= bg[:-1, :]; near[:-1, :] |= bg[1:, :]; near[:, 1:] |= bg[:, :-1]; near[:, :-1] |= bg[:, 1:]
        bg = bg | (near & (mx < DARK_FRINGE))
    return bg


def bleed_colour(rgb: np.ndarray, opaque: np.ndarray, rings: int = 6) -> np.ndarray:
    """Give transparent pixels the colour of the nearest art pixel, ring by ring, so a filtered edge fades to the art's own colour, not to black."""
    out = rgb.astype(np.float32).copy()
    have = opaque.copy()
    for _ in range(rings):
        acc = np.zeros_like(out); cnt = np.zeros(have.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            src = np.roll(np.roll(have, dy, 0), dx, 1); col = np.roll(np.roll(out, dy, 0), dx, 1)
            take = src & ~have
            acc[take] += col[take]; cnt[take] += 1
        grow = cnt > 0
        out[grow] = acc[grow] / cnt[grow][:, None]
        have = have | grow
    return out.clip(0, 255).astype(np.uint8)


def bake_mid(src: str | None = None, name: str = "garden-mid") -> str:
    rgb = np.asarray(Image.open(src or os.path.join(SRC, "mid-garden.png")).convert("RGB"))
    bg = surround_mask(rgb)
    ys, xs = np.nonzero(~bg)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    rgb, opaque = rgb[y0:y1 + 1, x0:x1 + 1], ~bg[y0:y1 + 1, x0:x1 + 1]
    colour = bleed_colour(rgb, opaque)
    alpha = Image.fromarray(np.where(opaque, 255, 0).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    out = np.dstack([colour, np.asarray(alpha)])
    im = Image.fromarray(out)
    path = os.path.join(OUT, f"{name}.webp")
    im.save(path, "WEBP", quality=86, method=6, alpha_quality=100)
    solid = float(opaque.mean())
    return f"{path}  {im.size[0]}x{im.size[1]}  {os.path.getsize(path) // 1024} KB  ({solid:.0%} opaque)"


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    if sys.argv[1:] == ["worlds"]:
        for name, src in WORLD_FARS:
            print(f"{name}: {bake_far(src, name)}")
        for name, src in WORLD_MIDS:
            print(f"{name}: {bake_mid(src, name)}")
    elif not sys.argv[1:]:
        for name, fn in (("far", bake_far), ("mid", bake_mid)):
            print(f"{name}: {fn()}")
    else:
        print("usage: make-backdrops.py [worlds]"); sys.exit(2)
    sys.exit(0)
