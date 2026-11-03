"""Build far-night.png: a band-shaped panorama from far-garden.png.

Why: the play camera only shows a ~7:1 sliver of the backdrop, but far-garden.png is 3:2 with a big empty
sky gap between the moon and the hills. We re-compose it WITHOUT stretching anything:
  * sky = the image's own vertical gradient (median per row), compressed vertically (a smooth gradient may be)
  * stars + moon = lifted out of the original as additive deltas (they are sprites on a smooth gradient),
    placed back at real shape; the moon exactly once, stars scattered across the whole width
  * hills = the original rows at 1:1, mirrored left/right to widen (smooth hills hide a mirror well)
"""
import sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
rng = np.random.default_rng(20261103)

src = np.array(Image.open(SRC).convert("RGB")).astype(np.float32)[:, 3:-3]   # trim the artifact border columns
H, W, _ = src.shape
HILL0 = 800                                  # first original row that can contain a hill (crest top is ~808)
prof = np.median(src[:830], axis=1)          # (830, 3) sky colour per row (pure vertical gradient: median dev = 1)
SKY_ROWS = 280                               # new rows above the hill band; original rows 0..HILL0 are compressed into them
HILL_ROWS = H - HILL0                        # 480
H_OUT, W_OUT = SKY_ROWS + HILL_ROWS, W * 3   # 760 x 5742  (7.55:1, the band's shape)

# ---- 1. sky gradient (compressed vertically) --------------------------------------------------------------
out = np.zeros((H_OUT, W_OUT, 3), np.float32)
for y in range(SKY_ROWS):
    r = y * (HILL0 / SKY_ROWS)
    r0 = int(r); f = r - r0
    out[y, :, :] = prof[r0] * (1 - f) + prof[min(r0 + 1, 829)] * f

# ---- 2. hills: original rows at 1:1, mirrored to 3x width (mirror seams are continuous by construction) ----
tile = src[HILL0:]
out[SKY_ROWS:, :, :] = np.concatenate([tile[:, ::-1], tile, tile[:, ::-1]], axis=1)

# ---- 3. lift stars + moon out of the original sky as additive deltas ---------------------------------------
delta = src[:500] - prof[:500, None, :]
MOON_Y, MOON_X, MOON_R = 352, 1342 - 3 + 3, 130                  # centre in trimmed coords (x already trimmed by 3)
MOON_X = 1342 - 3
yy, xx = np.mgrid[:500, :W]
near_moon = (yy - MOON_Y) ** 2 + (xx - MOON_X) ** 2 <= MOON_R ** 2
mask = (delta.max(axis=2) > 18) & ~near_moon
# dilate mask by 2 px (plain numpy), then label by flood fill
m = mask.copy()
for _ in range(2):
    d = m.copy(); d[1:] |= m[:-1]; d[:-1] |= m[1:]; d[:, 1:] |= m[:, :-1]; d[:, :-1] |= m[:, 1:]; m = d
seen = np.zeros_like(m); stars = []
ys, xs = np.nonzero(m)
for y0, x0 in zip(ys, xs):
    if seen[y0, x0]: continue
    stack = [(y0, x0)]; seen[y0, x0] = True; pts = []
    while stack:
        y, x = stack.pop(); pts.append((y, x))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < 500 and 0 <= nx < W and m[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; stack.append((ny, nx))
    py = [p[0] for p in pts]; px = [p[1] for p in pts]
    ya, yb, xa, xb = min(py) - 3, max(py) + 4, min(px) - 3, max(px) + 4
    if ya < 0 or xa < 0 or yb > 500 or xb > W: continue
    sp = delta[ya:yb, xa:xb].copy()
    border = np.concatenate([sp[0], sp[-1], sp[:, 0], sp[:, -1]]); sp -= np.median(border, axis=0)   # drop the sky's own tiny offset
    h, w = sp.shape[:2]; win = np.outer(np.hanning(h + 2)[1:-1] ** 0.5, np.hanning(w + 2)[1:-1] ** 0.5)  # fade to 0 at the box edge
    stars.append((sp * win[:, :, None]).astype(np.float32))   # PIL 'F' mode needs float32
print("stars lifted:", len(stars), "| sprite sizes (px) median:", int(np.median([s.shape[0] for s in stars])))

def scaled(sprite, k):
    h, w = sprite.shape[:2]; nh, nw = max(2, round(h * k)), max(2, round(w * k))
    chans = [np.array(Image.fromarray(sprite[:, :, c], mode="F").resize((nw, nh), Image.BICUBIC)) for c in range(3)]
    return np.stack(chans, axis=2)            # upscaling keeps the peak value; the sprite just gets bigger and softer

def paste(canvas, sprite, cy, cx):
    h, w = sprite.shape[:2]; y0, x0 = int(cy - h // 2), int(cx - w // 2)
    ya, xa = max(0, y0), max(0, x0); yb, xb = min(canvas.shape[0], y0 + h), min(canvas.shape[1], x0 + w)
    if ya >= yb or xa >= xb: return
    canvas[ya:yb, xa:xb] += sprite[ya - y0:yb - y0, xa - x0:xb - x0]

# ---- 4. stars scattered over the full width, 2x so they survive the downscale to screen --------------------
STAR_K = 2.0
area_new, area_old = W_OUT * 230, W * 360
n_new = int(len(stars) * area_new / area_old / (STAR_K ** 0.5))
MOON_NEW_X, MOON_NEW_Y, MOON_K = int(W * 1.5 + 440), 150, 2.5             # right of centre of the middle copy
for _ in range(n_new):
    cx, cy = rng.integers(30, W_OUT - 30), rng.integers(12, 245)
    if (cx - MOON_NEW_X) ** 2 + (cy - MOON_NEW_Y) ** 2 < 150 ** 2: continue   # keep the moon's glow clean
    paste(out, scaled(stars[rng.integers(len(stars))], STAR_K), cy, cx)
print("stars placed:", n_new, "across", W_OUT, "px")

# ---- 5. the moon, exactly once ----------------------------------------------------------------------------
moon = delta[MOON_Y - MOON_R:MOON_Y + MOON_R, MOON_X - MOON_R:MOON_X + MOON_R].copy()
# remove any star sprites that fall inside the moon patch (keep glow + disc only)
rr = np.sqrt((np.mgrid[:2 * MOON_R, :2 * MOON_R][0] - MOON_R) ** 2 + (np.mgrid[:2 * MOON_R, :2 * MOON_R][1] - MOON_R) ** 2)
moon *= np.clip((MOON_R - rr) / 25.0, 0, 1)[:, :, None]                    # feather the patch edge to nothing
paste(out, scaled(moon, MOON_K), MOON_NEW_Y, MOON_NEW_X)

Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(OUT)
print("saved", OUT, W_OUT, "x", H_OUT, "aspect %.2f" % (W_OUT / H_OUT))
