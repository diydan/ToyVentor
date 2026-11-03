"""Build far-day.png: the DAYTIME twin of far-night.png, from the same far-garden.png (same band shape, same hills).

  python3 make_far_day.py far-garden.png far-day.png

Recipe (nothing is stretched):
  * sky      = a day gradient written over the band (deep blue at the top, pale haze at the horizon)
  * sun      = one disc + soft glow (the night moon's slot), clouds = soft blobs scattered over the full width
  * hills    = the ORIGINAL hill rows at 1:1, mirrored 3x wide like the night version, but recoloured: the original's
               own tonal layering (far = light, near = dark) is kept and mapped navy -> hazy blue-green / green
The hill silhouette is found exactly as in make_far_night.py: per column, the first row that steps >= 4 levels from
the smooth sky gradient; the sky pixels in the valleys are then replaced by the day sky so nothing navy survives.
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
rng = np.random.default_rng(20261103)

src = np.array(Image.open(SRC).convert("RGB")).astype(np.float32)[:, 3:-3]      # trim the artifact border columns
H, W, _ = src.shape
HILL0, SKY_ROWS = 800, 280
H_OUT, W_OUT = SKY_ROWS + (H - HILL0), W * 3                                       # 760 x 5742 (7.56:1, the band's shape)

# ---- sky: vertical day gradient ------------------------------------------------------------------------------
stops = [(0, (78, 150, 236)), (170, (126, 192, 244)), (300, (184, 224, 252)), (H_OUT, (210, 238, 252))]
ys = np.arange(H_OUT)
sky_col = np.stack([np.interp(ys, [s[0] for s in stops], [s[1][c] for s in stops]) for c in range(3)], axis=1)   # (H_OUT, 3)
out = np.repeat(sky_col[:, None, :], W_OUT, axis=1).astype(np.float32)

# ---- hills: silhouette from the original, recoloured -----------------------------------------------------------
step = np.abs(np.diff(src, axis=0)).max(axis=2)
raw = np.array([790 + np.nonzero(step[790:, x] >= 4)[0][0] + 1 for x in range(W)]).astype(np.float32)
k = 9; edge = np.convolve(np.pad(raw, k // 2, mode="edge"), np.ones(k) / k, mode="valid")        # 9-px moving average
tile = src[HILL0:]                                                                                 # (480, W, 3)
tile_m = np.concatenate([tile[:, ::-1], tile, tile[:, ::-1]], axis=1)                              # mirror seams are continuous
edge_m = np.concatenate([edge[::-1], edge, edge[::-1]])
rows = (HILL0 + np.arange(tile_m.shape[0]))[:, None]
alpha = np.clip(rows - edge_m[None, :] + 0.5, 0.0, 1.0)                                           # 1 below the crest, AA'd at the edge
lum = tile_m[..., 0] * 0.299 + tile_m[..., 1] * 0.587 + tile_m[..., 2] * 0.114     # (not @: Accelerate-numpy misbehaves on reversed strides)
def box_blur_x(a, r):
    cs = np.cumsum(np.pad(a, ((0, 0), (r + 1, r)), mode="edge"), axis=1)
    return (cs[:, 2 * r + 1:] - cs[:, :-(2 * r + 1)]) / (2 * r + 1)
lum = box_blur_x(lum, 10)                                                                           # colour only; the silhouette (alpha) is untouched
sel = alpha > 0.99
lo, hi = np.percentile(lum[sel], [2, 98])
t = np.clip((lum - lo) / (hi - lo), 0, 1)[..., None]                                               # 0 = nearest/darkest, 1 = farthest/lightest
dark, light = np.array([50, 124, 76], np.float32), np.array([136, 204, 172], np.float32)
hill_col = dark * (1 - t) + light * t
out[SKY_ROWS:] = out[SKY_ROWS:] * (1 - alpha[..., None]) + hill_col * alpha[..., None]

# ---- sun: disc + glow, in the moon's slot ---------------------------------------------------------------------
SUN_X, SUN_Y, SUN_R = int(W * 1.5 + 440), 150, 58
yy, xx = np.mgrid[:H_OUT, :W_OUT]
d = np.sqrt((yy - SUN_Y) ** 2 + (xx - SUN_X) ** 2).astype(np.float32)
glow = np.exp(-(d / 150.0) ** 2) * 0.55 + np.exp(-(d / 60.0) ** 2) * 0.35
out += glow[..., None] * np.array([255, 240, 190], np.float32) * (1 - out / 400.0) * 0.55
disc = np.clip((SUN_R - d) / 3.0, 0, 1)[..., None]
out = out * (1 - disc) + np.array([255, 251, 228], np.float32) * disc

# ---- clouds: soft blobs, flatter at the bottom, a touch of blue underneath -----------------------------------
layer = Image.new("RGBA", (W_OUT, H_OUT), (255, 255, 255, 0))
n_clouds = 13
for i in range(n_clouds):
    cx = int((i + 0.5) * W_OUT / n_clouds + rng.integers(-150, 150)); cy = int(rng.integers(34, 200))
    if (cx - SUN_X) ** 2 + (cy - SUN_Y) ** 2 < 190 ** 2: continue
    w = int(rng.integers(190, 430)); h = int(w * rng.uniform(0.20, 0.30))
    cl = Image.new("RGBA", (w + 80, h * 4), (0, 0, 0, 0)); dr = ImageDraw.Draw(cl)
    for _ in range(int(rng.integers(6, 10))):
        bw = int(w * rng.uniform(0.22, 0.42)); bh = int(h * rng.uniform(0.9, 1.7))
        bx = int(rng.uniform(0, w - bw)) + 40; by = int(h * 3 - bh * rng.uniform(0.7, 1.0))
        dr.ellipse([bx, by - bh // 2, bx + bw, by + bh // 2], fill=(255, 255, 255, 255))
    dr.rectangle([40, h * 3, w + 40, h * 4], fill=(0, 0, 0, 0))                                    # flat bottom
    cl = cl.filter(ImageFilter.GaussianBlur(5))
    a = np.array(cl)[..., 3].astype(np.float32) / 255.0
    ch = a.shape[0]; shade = np.linspace(0.0, 1.0, ch)[:, None]                                    # bluer underside
    rgb = np.stack([255 - 40 * shade, 255 - 26 * shade, 255 - 8 * shade], axis=-1) * np.ones((1, a.shape[1], 1))
    ca = Image.fromarray(np.dstack([rgb, a * 235]).astype(np.uint8), "RGBA")
    layer.alpha_composite(ca, (max(0, cx - ca.width // 2), max(0, cy - ca.height // 2)))
la = np.array(layer).astype(np.float32); lam = la[..., 3:4] / 255.0
out = out * (1 - lam) + la[..., :3] * lam

Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(OUT)
print("saved", OUT, W_OUT, "x", H_OUT, "aspect %.2f" % (W_OUT / H_OUT))
