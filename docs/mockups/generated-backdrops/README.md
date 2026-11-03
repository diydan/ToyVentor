# Generated backdrop samples (Muse Image, measured 2026-11-03)

Evidence for [generated-worlds-spec.md](../../specs/generated-worlds-spec.md). Every image here was made by `muse-image-1.0` through `POST /images/generations`
with the key from `.dev.vars`; nothing was retouched. They are samples for judging, not shipped art. Re-run the measurements with
`node scripts/probe-muse-image.mjs` (see its header; `gen` costs one call).

| File | Requested | Got | Time | Prompt (verbatim) |
|---|---|---|---|---|
| `far-night.webp` | `4096x512` | 4480 x 560 (8:1) | 10.7 s | A wide panoramic night landscape for a children's game: a deep blue-purple starry sky with a glowing full moon, soft layered rolling hills in navy and indigo along the bottom. Smooth flat illustration, no text. |
| `far-day.webp` | `4096x512` | 4480 x 560 | 7.6 s | A wide panoramic daytime landscape for a children's game: a soft light-blue sky with a few fluffy white clouds and a bright sun, gentle layered rolling hills in pale blue-green along the bottom, hazy and light. Smooth flat illustration, no text, level horizon. |
| `mid-clay-on-black.webp` | `4096x512` | 4480 x 560 | 14.1 s | A wide horizontal strip of cute rounded rolling hills in teal and mint green with small round cartoon trees and one tiny cozy cottage with warm lit windows, soft clay toy style, centered with empty space above, on a PURE SOLID BLACK background (#000000), nothing else, no ground line, no sky, no text. |
| `wall-tile-raw.webp` | `1024x1024` | 1600 x 1600 | 12.6 s | A seamless tileable wallpaper pattern for a children's bedroom: soft indigo background with small gold stars and tiny crescent moons, evenly spaced, flat illustration, the pattern must continue perfectly across all four edges, no border, no text. |
| `wall-tile-2x2-seam.webp` | (the tile above, repeated 2 x 2) | | | Shows the failure: the top-bottom join doubles and cuts a row of stars. |
| `preview-night-cam22.webp`, `preview-day-cam22.webp` | | | | The generated far band and mid strip loaded into the parallax mockup (`docs/mockups/parallax/`, same layout maths, real stage scale; its black-keying is the rough in-browser one, so a thin dark fringe shows on the day hills; the shipped bake script removes it). |

**What the numbers say.** `size` only sets the aspect ratio (at most 16:1); the output is always about 2.5 megapixels, so `2048x256` and `4096x512` returned the identical
4480 x 560, and `1024x1024` returned 1600 x 1600. There is no transparency, seed, quality, style or negative-prompt parameter. Each image reports about 17,000
input and 1,200 output tokens. The wallpaper tile's left-right seam is fine (mean edge difference 3.7 against 2.0 for ordinary neighbouring columns) but the top-bottom
seam is not (15.8 against 1.7), so a "seamless" prompt cannot be trusted and tiles need a seam gate.
