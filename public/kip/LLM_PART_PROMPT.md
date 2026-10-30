# ToyVentor Kip — Conforming LLM Part-Maker Prompt (`PartSpec v2`)

Copy and paste everything below into any LLM or local coding model, replace `[DESCRIBE YOUR PART]` at the bottom, and save the returned Python script as `my_part.py`. Then validate and export a 3D-printable, game-ready `.stl` with:

```bash
npm run kip:validate-part -- my_part.py
```

---

## System / Authoring Prompt

You are designing a 3D-printable, game-ready modular toy part for **Kip** using the **ToyVentor PartSpec v2 Python SDK** (`kip_partspec_sdk.py`, built on `manifold3d`).

Output **one self-contained Python 3 file** starting with `from kip_partspec_sdk import *` and ending with `if __name__ == "__main__": run_cli(PART)`.

### 1. Coordinate System & Units
- Units are **millimetres (`mm`)**. ToyVentor grid pitch is **`12.5 mm` (`1 TU`)**.
- **`-Y` is FRONT** (where the character or vehicle faces!), **`+Y` is BACK**, **`±X` is Left / Right**, and **`+Z` is UP** (`z = 0` sits on the print bed).

### 2. Always Use One of the 6 Conforming Slot Builders (Never Hardcode Socket/Stud Dimensions!)
Pick the `slot` and matching builder for the requested part:

| `slot` value | Fits onto | Builder function to return from `build()` | Local `z = 0` meaning |
|---|---|---|---|
| `"crown"` | Any character head's `2×1` Crown Buds | `crown_addon(body)` | Top of the `2×1` crown pad (`23.8 × 11.6 mm` footprint) |
| `"head"` | Kip's `neck_turret_2x1` or any `2×1` neck | `character_head(body, height_mm=30.5)` | Neck base (`24.6 × 12.1 mm` collar); auto-adds `2×1` Crown Buds |
| `"back"` | Kip's `2×2` backpack studs | `backpack_addon(body, grid=(2, 2), top_studs_z=None)` | Backpack base (`24.6 × 24.6 mm`); optional top `2×1` studs |
| `"hand"` | Kip's `Ø 6.75 mm` C-grip hands & Pro bores | `handheld_prop(cs_2d, grip_tu=2, crest_height_mm=1.6)` | Pass a 2D `CrossSection` in `(x, z)` with `z >= 0` |
| `"front"` / `"rollbar"` / `"spoiler"` | Modular Car/Truck `2×1` ports | `vehicle_addon(body, slot="spoiler")` | Top of `2×1` socket pad (`23.8 × 11.6 mm`) |
| `"hood"` / `"roof"` | Modular Car hood or Truck roof (`2×2`) | `vehicle_addon(body, slot="hood")` | Top of `2×2` socket pad (`23.8 × 23.8 mm`) |
| `"exhaust"` | Modular Car/Scooter rear `1×2` port | `vehicle_addon(body, slot="exhaust")` | Top of `1×2` socket pad (`11.6 × 23.8 mm`) |

### 3. Available Geometry Helpers (Already Imported by `from kip_partspec_sdk import *`)
- `rounded_slab(w, d, h, r=4.0, z=0.0, x=0.0, y=0.0)` — rounded box `w × d × h` (`mm`), bottom at `z`, centred at `(x, y)`.
- `loft_slabs([(z, w, d, r), (z, w, d, r, x, y), ...])` — smooth convex loft through rounded slabs.
- `sphere(r, (x, y, z))`, `cylinder(h, r, z=0.0, x=0.0, y=0.0)` — primitives.
- `union([m1, m2, ...])`, `hull([m1, m2, ...])`, `+` (union), `-` (difference), `^` (intersection).
- `polygon_2d([(x, z), ...], fillet_r=1.2)` and `star_2d(points=5, r_outer=17.5, r_inner=9.2, center_z=18.0)` — 2D profiles for `handheld_prop(...)`.

### 4. Printability, Safety & ToyVentor Brand Rules (Hard Gates!)
1. **Zero Supports & Zero Ledges (`P1_no_supports`, `P4_no_ledges`)**: Every outward flare from a lower slice `(w0, d0)` at `z0` to `(w1, d1)` at `z1` MUST keep horizontal growth `<= 0.78 * (z1 - z0)` on every side (`<= 38°` from vertical). Never hang downward tips or flat horizontal shelves over empty air.
2. **Small-Parts Cylinder Non-Marginal Rule (`S1_small_part_screen`)**: Keep minimum enclosing cylinder diameter **either `< 29.5 mm`** (labelled `small_part`) **or `> 36.0 mm`** (`above_cylinder`). Avoid the `31.75–34.93 mm` marginal band!
3. **ToyVentor Brand Rules (`BRAND_STYLE.md`)**:
   - **Never** carve or extrude 3D eyes, mouths, nostrils, or teeth on heads (`slot="head"`); leave the `-Y` front face smooth for 2D decal expressions!
   - **Never** mention third-party toy/brick brand names in `id`, `name`, `behavior`, or comments.
   - `stat` MUST be one of `"Speed"`, `"Spin"`, `"Torque"`, or `"Glow"`.

### 5. Complete Minimal Template
```python
from kip_partspec_sdk import *


def build():
    hat = loft_slabs([
        (0.0, 23.4, 11.4, 4.6, 0.0, 0.0),
        (7.5, 27.5, 17.0, 6.2, 0.0, -1.8),
        (17.0, 11.0, 11.0, 4.5, 0.0, -0.5),
        (23.5, 5.6, 5.6, 2.4, 0.0, 1.2),
    ])
    return crown_addon(hat)


PART = part_spec(
    id="custom_wizard_hat",
    name="Starlight Wizard Hat",
    stat="Glow",
    behavior="Pointed starlight hat that snaps onto any 2x1 character crown",
    slot="crown",
    fn=build,
)

if __name__ == "__main__":
    run_cli(PART)
```

---

**PART REQUEST:** `[DESCRIBE YOUR PART — e.g. "A twin-fin dragon crest helmet for Kip's crown with Speed stat"]`
