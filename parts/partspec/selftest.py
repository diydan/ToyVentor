#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Self-test for the ToyVentor model. Run after `generate`: python3 selftest.py out"""
import itertools
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import toyventor_assembly as asm  # noqa: E402
import toyventor_index as ix  # noqa: E402
import toyventor_parts as tp  # noqa: E402

out = Path(sys.argv[1] if len(sys.argv) > 1 else "out")
man = json.loads((out / "toyventor_parts.json").read_text())
idx = json.loads((out / "toyventor_index.json").read_text())
parts = [p for p in man["parts"] if p.get("file")]
FAILS = []


def test(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        FAILS.append(name)


# 1. checks are declared once, emitted everywhere, with valid levels
emitted = {c["id"] for p in parts for c in p["checks"]}
dormant = set(tp.IF["checks"]) - emitted
test("every declared check is emitted, unless it applies to no part yet (dormant)", emitted <= set(tp.IF["checks"]) and
     not any(tp.check_applies(cid, p["connectors"], p["family"]) for cid in dormant for p in parts), f"dormant={sorted(dormant)}")
test("levels are block/warn/info", all(c["level"] in ("block", "warn", "info") for c in tp.IF["checks"].values()))
test("levels in manifest match interfaces.json", all(c["level"] == tp.level_of(c["id"]) for p in parts for c in p["checks"]))

# 2. severity is data: flipping a level changes blocking behaviour, then restore
fake = [{"id": "G1_watertight", "level": "block", "result": "fail", "detail": ""}]
before = bool(tp.blocking_failures(fake))
orig = tp.IF["checks"]["G1_watertight"]["level"]
tp.IF["checks"]["G1_watertight"]["level"] = "warn"
after = bool(tp.blocking_failures(fake))
tp.IF["checks"]["G1_watertight"]["level"] = orig
test("severity as data: block fail blocks, same fail as warn does not", before and not after)

# 3. pending checks are never a pass
pend = [(p["id"], c["id"]) for p in parts for c in p["checks"] if tp.IF["checks"][c["id"]].get("pending") and c["result"] != "pending"]
test("physical checks are always pending", not pend, str(pend))

# 4. no blocking failures in the shipped manifest
bf = [(p["id"], c["id"]) for p in parts for c in tp.blocking_failures(p["checks"])]
test("no blocking failures in manifest", not bf, str(bf))

# 5. index matches manifest
conn_ifaces = {c["interface"] for p in parts for c in p["connectors"]}
test("index covers every connector interface", conn_ifaces == set(idx["interfaces"]))
known = set(tp.IF["interfaces"]) | {"forge_mount.attach"}
test("every connector interface is defined in interfaces.json", conn_ifaces <= known, str(conn_ifaces - known))
users = {pid for e in idx["interfaces"].values() for pid in e["uses"]}
test("every part with connectors is indexed", users == {p["id"] for p in parts if p["connectors"]})

# 6. mating rule is symmetric
conns = [c for p in parts for c in p["connectors"]]
test("complementary() is symmetric", all(ix.complementary(a, b) == ix.complementary(b, a) for a, b in itertools.product(conns, conns)))

# 7. build validator regressions
res = asm.demo(out / "toyventor_parts.json", out)
want_ok = ["valid_ring_brick_tail", "valid_offset_stack_2_studs", "valid_beams_friction_pin", "valid_shaft_beam_bushing", "valid_gear_pair_3tu", "valid_rack_and_pinion", "valid_ring_and_pinion", "valid_snap_on_pro_adapter", "valid_beam_on_pro_mount", "valid_hinge", "valid_cart_axle", "valid_racer_wheels", "valid_pro_gear_scene", "valid_robot_bolt", "valid_kip_seated_wardrobe", "valid_kip_seated_tall", "valid_kip_seated_jumbo", "valid_kip_roadster_car", "valid_kip_hauler_truck", "valid_kip_motor_scooter", "valid_kip_sport_moto", "valid_kip_skateboard", "valid_pro_tie_rod_link_on_rack"]
test("known-good builds are accepted", all(res[k]["ok"] for k in want_ok))
codes = lambda k: {e["code"] for e in res[k]["errors"]}  # noqa: E731
test("size mismatch is caught", "size_mismatch" in codes("INVALID_large_tail_on_small_plate"))
test("floating part is caught", "floating" in codes("INVALID_floating_wings"))
test("collision is caught", "collision" in codes("INVALID_overlapping_bricks"))
test("verified parts raise no warning", not res["valid_ring_brick_tail"]["warnings"])
# fixture: same manifest with one part demoted, so the warning path stays covered when every real part is verified
import tempfile  # noqa: E402
demoted = json.loads((out / "toyventor_parts.json").read_text())
for p in demoted["parts"]:
    if p["id"] == "waddle_tail":
        p["design_status"] = "needs_reproportion"
with tempfile.TemporaryDirectory() as d:
    (Path(d) / "m.json").write_text(json.dumps(demoted))
    lib_u = asm.Library(Path(d) / "m.json")
    r_ = asm.place("forge_mount_ring", pid="ring")
    b_ = asm.attach(lib_u, r_, "top_studs", "big_blue_brick", "under_sockets", (0, 0), (0, 0), pid="brick")
    t_ = asm.attach(lib_u, b_, "top_studs", "waddle_tail", "under_sockets", (0, 0), (0, 0), pid="tail")
    res_u = asm.validate(lib_u, [r_, b_, t_])
test("unverified parts raise a warning", any(w["code"] == "unverified_part" for w in res_u["warnings"]))

# 7b. design_status is derived from the checks, never declared
test("status is not hand-declared", not hasattr(tp, "DESIGN_STATUS"))
pass_c = [{"id": "G1_watertight", "result": "pass"}, {"id": "F1_printed_fit", "result": "pending"}]
fail_c = [{"id": "G1_watertight", "result": "fail"}]
warn_c = [{"id": "S1_small_part_screen", "result": "fail"}]
test("blocking failure => needs_reproportion", tp.derive_status(fail_c, {"status": "above_cylinder"}, "small") == "needs_reproportion")
test("marginal small-part result => needs_reproportion", tp.derive_status(pass_c, {"status": "marginal"}, "small") == "needs_reproportion")
test("pending physical checks do not block verified", tp.derive_status(pass_c, {"status": "above_cylinder"}, "small") == "verified")
test("warn-level failure does not block verified", tp.derive_status(warn_c, {"status": "small_part"}, "small") == "verified")
test("Large part inside the cylinder => needs_reproportion", tp.derive_status(pass_c, {"status": "small_part"}, "large") == "needs_reproportion")
test("every stored status matches the derived status", all(
    p["design_status"] == tp.derive_status(p["checks"], {"status": p["safety"]["small_part_status"]}, p["size_class"]) for p in parts))
test("planned checks never overlap enforced checks", not (set(tp.IF["planned_checks"]) & set(tp.IF["checks"])))

# 7c. fit and tolerance: the checks must catch bad fits and prove every intended connection
from toyventor_fit import fit_report  # noqa: E402


def synthetic_fit(fit_mm, size="small"):
    """Seat a socket block built with a different clearance on a nominal stud block, and judge it against the interface."""
    p = tp.STUD[size]
    male = tp.block(size, 2, 2, p["brick_h"], p["brick_top"])
    saved = p["fit"]
    try:
        p["fit"] = fit_mm
        female = tp.block(size, 2, 2, p["plate_h"], p["plate_top"], studs=False).translate((0, 0, p["brick_h"]))
    finally:
        p["fit"] = saved
    return tp.fit_verdict(fit_report(male, female, p["brick_h"] + p["stud_h"] / 2), size)


for size in ("small", "large"):
    nominal = tp.STUD[size]["fit"]
    test(f"{size}: nominal cavity passes T1 and T2", all(synthetic_fit(nominal, size)[k] for k in ("as_designed", "in_window")))
    test(f"{size}: cavity 0.5 mm too loose is caught by T1", not synthetic_fit(nominal + 0.5, size)["as_designed"])
    test(f"{size}: cavity too tight (interference) is caught by T1", not synthetic_fit(-0.2, size)["as_designed"])
    test(f"{size}: faceting allowance is under 0.01 mm", tp.facet_allowance(size) < 0.01, f"{tp.facet_allowance(size):.4f}")


def synthetic_interface(fit_mm, size="small"):
    """The interface ITSELF is changed (male and female both follow it), then judged."""
    p = tp.STUD[size]
    saved = p["fit"]
    try:
        p["fit"] = fit_mm
        male = tp.block(size, 2, 2, p["brick_h"], p["brick_top"])
        female = tp.block(size, 2, 2, p["plate_h"], p["plate_top"], studs=False).translate((0, 0, p["brick_h"]))
        return tp.fit_verdict(fit_report(male, female, p["brick_h"] + p["stud_h"] / 2), size)
    finally:
        p["fit"] = saved


for size in ("small", "large"):
    test(f"{size}: an interface changed to a loose clearance (0.6) is blocked", not synthetic_interface(0.6, size)["as_designed"])
    test(f"{size}: an interface changed to interference (-0.4) is blocked", not synthetic_interface(-0.4, size)["as_designed"])
test("every part's fit measured at least one stud or pin (friction-only parts are listed, not measured)", all(p["fit"].get("studs_measured", 0) > 0 or (p["fit"].get("pairs") and all(q["fit"] == "friction" for q in p["fit"]["pairs"])) for p in parts))
fm = json.loads((out / "fit_matrix.json").read_text())
test("fit matrix: every mating pair fits as designed", fm["pairs"] and all(r["as_designed"] for r in fm["pairs"]), str([r["male"] + "x" + r["female"] for r in fm["pairs"] if not r["as_designed"]]))
test("fit matrix: every pair is inside the tolerance window", all(r["in_window"] for r in fm["pairs"]))
test("fit matrix: no connector without a partner", not fm["orphans"], str(fm["orphans"]))
test("fit matrix covers every mating pair in the index", len(fm["pairs"]) == sum(len(e["mates"]) for e in idx["interfaces"].values()))
test("build edges carry the measured gap (friction and gear-mesh edges excepted)", all("gap_min_mm" in e for r in res.values() for e in r.get("edges", []) if e.get("fit") not in ("friction", "mesh")))
test("valid builds raise no fit warning", not any(w["code"] == "fit_out_of_tolerance" for n, r in res.items() if n.startswith("valid") for w in r["warnings"]))

# 7d. catalog: the plan for the top 30 Snap and top 30 Pro parts stays consistent with the generator
import make_catalog  # noqa: E402
cat = make_catalog.CAT
ids = [p["id"] for p in cat["parts"]]
wave_ids = [w["id"] for w in cat["waves"]]
test("catalog ids are unique", len(ids) == len(set(ids)))
test("catalog has the target count per line", all(sum(p["line"] == ln for p in cat["parts"]) == n for ln, n in cat["targets"].items()))
test("catalog waves exist and only depend on earlier waves", all(p["wave"] in wave_ids + [None] for p in cat["parts"]) and
     all(all(r in wave_ids[:i] for r in w["requires"]) for i, w in enumerate(cat["waves"])))
def _scope_counts(w):
    m = re.match(r"^(\d+) parts \((\d+) Snap Small, (\d+) Pro\)", w.get("scope", ""))
    return tuple(int(g) for g in m.groups()) if m else None
test("wave scope leading counts match counted membership", all(
    _scope_counts(w) is None or _scope_counts(w) == (sum(1 for p in cat["parts"] if p.get("wave") == w["id"]),
    sum(1 for p in cat["parts"] if p.get("wave") == w["id"] and p["line"] == "snap"),
    sum(1 for p in cat["parts"] if p.get("wave") == w["id"] and p["line"] == "pro")) for w in cat["waves"]))
test("every generated part is in the catalog", all(p["id"] in ids for p in parts))
test("catalog sizes follow the line (Snap small/large, Pro pro)", all(p["size"] in (("small", "large") if p["line"] == "snap" else ("pro",)) for p in cat["parts"] if p["family"] != "forge_mount") )
test("Snap grids in ids are at least 2x2", all(min(int(d) for d in p["id"].split("_")[-1].split("x")) >= 2 for p in cat["parts"] if p["line"] == "snap" and p["family"] in ("block", "tile", "slope", "round") and p["id"].split("_")[-1][0].isdigit()))
pr = make_catalog.progress(cat, man)
test("catalog progress counts only verified parts", all(s["verified"] == sum(1 for p in parts if p["id"] in {q["id"] for q in cat["parts"] if q["line"] == ln} and p["design_status"] == "verified") for ln, s in pr["lines"].items()))

# 7e. W0 foundation: catalog-driven families, Pro checks (dormant in the catalog, proven on fixtures), pin-and-bore mating
import contextlib  # noqa: E402
import tempfile  # noqa: E402
import toyventor_pro as pro  # noqa: E402
from jsonschema import Draft202012Validator  # noqa: E402

V = Draft202012Validator(tp.SCHEMA)


def eval_row(**r):
    base = dict(line="snap", behavior="test", tags=["test"], stat="Test")
    base.update(r)
    return tp.evaluate(tp.part_from_row(base), V)


def row_status(**r):
    e, tm, bad, small = eval_row(**r)
    return e["design_status"], small["status"]


test("every catalog row with build info is registered, and only those", {p["id"] for p in tp.PARTS} == {r["id"] for r in tp.CATALOG["parts"] if "build" in r})
for fam, size, build in (("block", "small", {"kind": "plate", "grid": [2, 2]}), ("block", "large", {"kind": "brick", "grid": [4, 2]}), ("tile", "large", {"grid": [2, 2]}),
                         ("slope", "large", {"grid": [2, 2], "angle_deg": 45}), ("slope", "small", {"grid": [2, 2], "angle_deg": 30}), ("dome", "small", {"grid": [2, 2]})):
    test(f"family {fam} {size} {build.get('kind') or ''}: one catalog row passes the gate", row_status(id="t", name="t", family=fam, size=size, build=build)[0] == "verified")
test("a slope that lands in the marginal band is NOT verified (small, 45 degrees)", row_status(id="t", name="t", family="slope", size="small", build={"grid": [2, 2], "angle_deg": 45}) == ("needs_reproportion", "marginal"))

fixtures = pro.fixtures()
fx_dir = Path(tempfile.mkdtemp())
fx_entries = {}
for part in fixtures:
    e, tm, bad, small = tp.evaluate(part, V)
    tm.export(fx_dir / e["file"])
    fx_entries[part["id"]] = e
test("all Pro fixtures verify through the real gate", all(e["design_status"] == "verified" for e in fx_entries.values()), str({k: v["design_status"] for k, v in fx_entries.items()}))
ids_of = lambda e: {c["id"] for c in e["checks"]}  # noqa: E731
test("applicability: beams get I4 and I5, pins get I5 only, gears get I4 I5 I6, none get I3",
     {"I4_bore_on_grid", "I5_pin_fits_bore"} <= ids_of(fx_entries["fx_beam_free_tu03"]) and "I4_bore_on_grid" not in ids_of(fx_entries["fx_pin_free"]) and "I5_pin_fits_bore" in ids_of(fx_entries["fx_pin_free"])
     and "I6_gear_on_grid" in ids_of(fx_entries["fx_gear_z20"]) and not any("I3_seats_on_reference" in ids_of(e) for e in fx_entries.values()))
test("every part carries exactly the checks that apply to it", all(
    ids_of(p) - {"M1_manifest_schema"} == {cid for cid in tp.IF["checks"] if cid != "M1_manifest_schema" and tp.check_applies(cid, p["connectors"], p["family"])} for p in parts))
_flat_gap = (pro.BORE["fixed_flats"] - pro.BORE["shaft_flats"]) / 2
test("measured free-bore gap is the interface gap (0.2 mm)", abs(fx_entries["fx_beam_free_tu03"]["fit"]["gap_min_mm"] - 0.2) < 0.01)
test(f"measured flat-drive gap is the interface gap ({_flat_gap} mm)", abs(fx_entries["fx_beam_fixed_tu02"]["fit"]["gap_min_mm"] - _flat_gap) < 0.01)
sw = [e["fit"]["surface_offset_window_mm"] for e in fx_entries.values() if e["fit"].get("surface_offset_window_mm")]
test("Pro fit windows contain the calibrated error, same calibration as Snap", all(w[0] <= -0.05 and 0.05 <= w[1] for w in sw))


@contextlib.contextmanager
def bore_override(**kw):
    saved = {k: pro.BORE[k] for k in kw}
    pro.BORE.update(kw)
    try:
        yield
    finally:
        pro.BORE.update(saved)


def broken(base_id, overrides=None, mutate=None):
    """Build a fixture under changed interface numbers (or with its connector edited), then judge it against the nominal numbers."""
    base = next(p for p in fixtures if p["id"] == base_id)
    fn = base["fn"]

    def bad_fn():
        with bore_override(**(overrides or {})):
            m, conns, extras = fn()
        return m, (mutate(conns) if mutate else conns), extras
    e, tm, blocking, small = tp.evaluate({**base, "fn": bad_fn}, V)
    return e, {c["id"] for c in blocking}


e, b = broken("fx_beam_free_tu03", {"free_d": 7.6})
test("a bore built 0.6 mm too large is caught (I5 and T1)", {"I5_pin_fits_bore", "T1_fit_as_designed"} <= b and e["design_status"] == "needs_reproportion", str(b))
e, b = broken("fx_beam_fixed_tu02", {"fixed_flats": 5.5})
test("fixed-bore flats built too wide are caught", "I5_pin_fits_bore" in b, str(b))
e, b = broken("fx_shaft_drive", {"shaft_flats": 5.4})
test("a shaft built with flats too wide is caught", "I5_pin_fits_bore" in b, str(b))
e, b = broken("fx_beam_free_tu03", mutate=lambda cs: [{**cs[0], "frame": {**cs[0]["frame"], "origin": [cs[0]["frame"]["origin"][0] + 1.0, 0.0, 0.0]}}])
test("a bore declared 1 mm off the lattice is caught by I4", "I4_bore_on_grid" in b, str(b))
e, b = broken("fx_beam_free_tu03", mutate=lambda cs: [{**cs[0], "grid": {**cs[0]["grid"], "nx": 4}}])
test("a bore declared where there is no hole is caught by I4", "I4_bore_on_grid" in b, str(b))
test("I6 rejects a gear whose pitch diameter is not whole TU (12 teeth)", not pro.gear_on_grid({"gear": {"module_mm": 2.5, "teeth": 12}}, __import__("numpy").array([[-17.5, -17.5, 0], [17.5, 17.5, 12.5]]))[0])
test("I6 rejects a gear with the wrong module", not pro.gear_on_grid({"gear": {"module_mm": 3.0, "teeth": 20}}, __import__("numpy").array([[-33, -33, 0], [33, 33, 12.5]]))[0])
test("I6 accepts every tooth count that is a multiple of 5 at module 2.5", all(pro.gear_on_grid({"gear": {"module_mm": 2.5, "teeth": z}}, __import__("numpy").array([[-1.25 * (z + 2)] * 2 + [0], [1.25 * (z + 2)] * 2 + [12.5]]))[0] for z in (10, 15, 20, 25, 30)))

# pin-and-bore mating in the validator
(fx_dir / "m.json").write_text(json.dumps({"parts": list(fx_entries.values())}))
flib = asm.Library(fx_dir / "m.json", builders={p["id"]: p["fn"] for p in fixtures})
bf, bx = asm.place("fx_beam_free_tu03", pid="beam"), asm.place("fx_beam_fixed_tu02", pid="beamx")
codes_of = lambda r: {e["code"] for e in r["errors"]}  # noqa: E731
r1 = asm.validate(flib, [bf, asm.attach(flib, bf, "bores", "fx_pin_free", "axis", (1, 0), (0, 0), pid="pin", dz=-3.75)])
r2 = asm.validate(flib, [bx, asm.attach(flib, bx, "bores", "fx_shaft_drive", "axis", (1, 0), (0, 0), pid="sh", dz=-8.75)])
r3 = asm.validate(flib, [bx, asm.place("fx_pin_free", -6.25, 0, -3.75, pid="pin")])   # placed by hand: attach() refuses an unlisted pair
try:
    asm.attach(flib, bx, "bores", "fx_pin_free", "axis", (0, 0), (0, 0), pid="pin")
    refused = False
except ValueError:
    refused = True
test("attach() refuses a pin and bore that pin_bore.rules does not list", refused)
r4 = asm.validate(flib, [bf, asm.place("fx_pin_free", -9.5, 0, -3.75, pid="pin")])
r5 = asm.validate(flib, [bf, asm.place("fx_beam_free_tu03", 0, 0, 12.5, pid="beam2"), asm.attach(flib, bf, "bores", "fx_shaft_drive", "axis", (2, 0), (0, 0), pid="sh", dz=-2.5)])
test("a free pin in a free bore is accepted with a measured gap", r1["ok"] and r1["edges"][0]["fit"] == "free" and abs(r1["edges"][0]["gap_min_mm"] - 0.2) < 0.01, str(r1))
test("a flat shaft in a fixed bore is accepted as a press fit", r2["ok"] and r2["edges"][0]["fit"] == "press" and abs(r2["edges"][0]["gap_min_mm"] - _flat_gap) < 0.01, str(r2))
test("a round pin in a fixed bore is rejected: profile_mismatch", "profile_mismatch" in codes_of(r3), str(codes_of(r3)))
test("a pin off the bore axis is not connected", "floating" in codes_of(r4), str(codes_of(r4)))
test("one shaft through two stacked beams connects both", r5["ok"] and len(r5["edges"]) == 2, str(r5))
test("accepted pin builds raise no fit warning", not any(r["warnings"] for r in (r1, r2, r5)))
fm2 = asm.fit_matrix(flib)
test("Pro fit matrix: every listed pin/bore pair fits as designed, no connector without a partner", fm2["pairs"] and all(r["as_designed"] for r in fm2["pairs"]) and not fm2["orphans"], str(fm2["orphans"]))

# 7f. W2 Pro core with real parts
test("a round pin in a bushing (fixed bore) is rejected: profile_mismatch", "profile_mismatch" in codes("INVALID_round_pin_in_bushing"))
test("friction pin through two beams: two friction edges, no collision reported", res["valid_beams_friction_pin"]["ok"] and [e["fit"] for e in res["valid_beams_friction_pin"]["edges"]] == ["friction", "friction"])
test("shaft through a beam and a bushing: turning fit in the beam, press fit in the bushing",
     sorted(e["fit"] for e in res["valid_shaft_beam_bushing"]["edges"]) == ["free", "press"])
lay = [p for p in parts if p["id"].startswith(("shaft_", "pin_friction"))]
test("pins and shafts print lying on a flat (rotated, axis horizontal)", lay and all(p["print"].get("rotation_deg") and p["bbox_mm"][2] <= 5.01 for p in lay), str([(p["id"], p["bbox_mm"]) for p in lay]))
test("every Pro catalog part is verified once it has build info", all(p["design_status"] == "verified" for p in parts if p["line"] == "pro"))

# 7g. W3 Snap characters
by_id = {p["id"]: p for p in parts}
test("small Forge Mount seats a Small 2x2 part on four studs", by_id["forge_mount_ring_s"]["fit"]["studs_measured"] == 4)
test("Large variants clear the small-parts cylinder", all(by_id[i]["safety"]["small_part_status"] == "above_cylinder" for i in ("cloud_wings_l", "pebble_armor_shell_l", "glow_capsule_l")))
test("size variants reuse the original builder (one design, scaled)", all(next(r for r in tp.CATALOG["parts"] if r["id"] == v)["build"]["fn"] == next(r for r in tp.CATALOG["parts"] if r["id"] == o)["build"]["fn"]
     for v, o in (("cloud_wings_l", "cloud_wings"), ("pebble_armor_shell_l", "pebble_armor_shell"), ("zoom_capsule_s", "zoom_capsule"), ("glow_capsule_l", "glow_capsule"))))

# 7h. W4 gears, rack, ring, beams, Pro mount, adapter
fits_of = lambda name: sorted(e.get("fit") or "stud" for e in res[name]["edges"])  # noqa: E731
test("two gears whose pitch circles touch mesh (Z10 + Z20 at 3 TU)", "mesh" in fits_of("valid_gear_pair_3tu"))
test("gears placed too close are rejected: gear_mesh_distance", "gear_mesh_distance" in codes("INVALID_gears_2tu_apart"))
test("a pinion meshes with the rack and inside the ring", fits_of("valid_rack_and_pinion") == ["mesh"] and fits_of("valid_ring_and_pinion") == ["mesh"])
test("Snap on Pro: a friction pin joins beam and adapter, a Small brick sits on the adapter studs", fits_of("valid_snap_on_pro_adapter") == ["friction", "friction", "stud"])
test("a beam pins onto the Pro Forge Mount", fits_of("valid_beam_on_pro_mount") == ["friction", "friction"])
test("the adapter's fit covers both its studs and its bores", by_id["adapter_snap_pro"]["fit"].get("snap", {}).get("studs_measured") == 4 and by_id["adapter_snap_pro"]["fit"].get("pro", {}).get("studs_measured", 0) > 0)
test("every gear's pitch diameter is a whole number of TU", all(abs(p["gear"]["pitch_d_mm"] / 12.5 - round(p["gear"]["pitch_d_mm"] / 12.5)) < 1e-9 for p in parts if p.get("gear", {}).get("kind") in ("spur", "ring")))

# 7i. Forge Mount outlines: square from the catalog, round sized from the scan
def round_mount(face, size, d):
    row = dict(id="m", name="m", line="pro" if size == "pro" else "snap", family="forge_mount", size=size, behavior="t", tags=["t"], stat="Grip", type="Forge Mount",
               build={"fn": "forge_mount", "face": face, "outline": "round", "outer_d": d, "grid": [2, 2]})
    try:
        return tp.evaluate(tp.part_from_row(row), V)[0]
    except ValueError:
        return None


for face, size, d in (("stud_small", "small", 64), ("stud_large", "large", 100), ("bore_grid", "pro", 64)):
    e = round_mount(face, size, d)
    test(f"round Forge Mount ({face}, {d} mm) passes the gate", e is not None and e["design_status"] == "verified")
test("a round stud mount seats a 2x2 part on at least 3 studs", all(round_mount(f, s, d)["fit"]["studs_measured"] >= 3 for f, s, d in (("stud_small", "small", 64), ("stud_large", "large", 100))))
test("a round mount too small to seat a 2x2 part is refused", round_mount("stud_small", "small", 50) is None and round_mount("stud_large", "large", 80) is None)
test("round Pro mount bores are whole TU from the axis", next(c for c in round_mount("bore_grid", "pro", 90)["connectors"] if c["kind"] == "bore_grid").get("lattice") == "centre")
test("catalog mounts are square", all(p.get("mount_outline", {}).get("shape") == "square" for p in parts if p["family"] == "forge_mount"))

# 7j. integrated bases: add-ons and capsules carry their own stud holes, no plate around them
addons = [p for p in parts if p["family"] in ("addon", "capsule")]
test("every add-on and capsule has an integrated base (stud holes in its own underside)", addons and all(any(c.get("style") == "holes" for c in p["connectors"]) for p in addons))
test("every integrated part sits on a full plate with no stud hitting it", all(abs(float(next(c["detail"] for c in p["checks"] if c["id"] == "I3_seats_on_reference").split()[1])) <= 0.001 for p in addons))
locked = [r["id"] for r in tp.CATALOG["parts"] if r.get("build", {}).get("lock")]
test("every part whose direction matters is locked (two holes, or a hole and a keying relief)", locked and all(by_id[i]["sockets"]["locked"] for i in locked))
test("thin shapes stand on a pad with two holes", all(by_id[i]["sockets"]["holes"] == 2 for i in ("bumper_horns", "pointy_ears", "ridge_fin", "waddle_tail")))
test("Large add-ons and capsules still clear the small-parts cylinder", all(p["safety"]["small_part_status"] == "above_cylinder" for p in addons if p["size_class"] == "large"))


def integrated_refused(pid, **changes):
    row = copy.deepcopy(next(r for r in tp.CATALOG["parts"] if r["id"] == pid))
    for k in ("pad",):
        row["build"].pop(k, None)
    row["build"].update(changes)
    try:
        tp.part_from_row(row)["fn"]()
        return False
    except ValueError:
        return True


import copy  # noqa: E402
test("a thin shape without a pad is refused (no room for a hole)", integrated_refused("ridge_fin"))
test("a direction-sensitive part that would swivel on one stud is refused", integrated_refused("waddle_tail", lock=True))

# 7k. hugging Forge Mount: shoe (follows the toy, prints hugging face up) + face, joined by friction pins
def hug_row(**r):
    base = dict(id="x", name="x", behavior="t", tags=["t"], stat="Grip", type="T")
    base.update(r)
    return base


def hug_eval(**r):
    try:
        return tp.evaluate(tp.part_from_row(hug_row(**r)), V)[0]
    except ValueError:
        return None


shoes = [hug_eval(line="shared", family="forge_shoe", size="pro", build={"face": "stud_small", "outline": "round", "outer_d": 64, "surface": s, "radius_mm": R})
         for s in ("cylinder", "sphere") for R in (8, 12, 20, 35, 60, 120)]
test("hugging shoes print without supports on every stand-in toy surface (12 curvatures)", all(e and e["design_status"] == "verified" for e in shoes))
test("every shoe touches the toy over a real area", all(e["hug"]["contact_mm2"] > 300 for e in shoes))
test("a Large face is refused join pins (removable pins are small parts for under-3s)",
     hug_eval(line="snap", family="forge_mount", size="large", build={"face": "stud_large", "outline": "round", "outer_d": 100, "hole_d": 0, "join_pins": True, "grid": [2, 2]}) is None
     and hug_eval(line="shared", family="forge_shoe", size="pro", build={"face": "stud_large", "outline": "round", "outer_d": 100, "surface": "cylinder", "radius_mm": 20}) is None)
hug_rows = {
    "hug_face": hug_row(id="hug_face", line="snap", family="forge_mount", size="small", build={"face": "stud_small", "outline": "round", "outer_d": 64, "hole_d": 0, "join_pins": True, "grid": [2, 2]}),
    "hug_shoe": hug_row(id="hug_shoe", line="shared", family="forge_shoe", size="pro", build={"face": "stud_small", "outline": "round", "outer_d": 64, "surface": "cylinder", "radius_mm": 20}),
    "join_pin": hug_row(id="join_pin", line="pro", family="pin", size="pro", build={"fn": "friction_pin", "length_mm": 10, "fins_at_mm": [2.5, 7.5], "slot_end_mm": 1.0}),
}
hug_dir = Path(tempfile.mkdtemp())
hug_parts = {k: tp.part_from_row(r) for k, r in hug_rows.items()}
hug_entries = []
for k, part in hug_parts.items():
    e, tm, bad, small = tp.evaluate(part, V)
    tm.export(hug_dir / e["file"])
    hug_entries.append(e)
glow = next(p for p in parts if p["id"] == "glow_capsule")
hug_entries.append(glow)
import shutil  # noqa: E402
shutil.copy(out / glow["file"], hug_dir / glow["file"])
(hug_dir / "m.json").write_text(json.dumps({"parts": hug_entries}))
hlib = asm.Library(hug_dir / "m.json", builders={k: p["fn"] for k, p in hug_parts.items()})
T = next(e for e in hug_entries if e["id"] == "hug_shoe")["hug"]["pin_length_mm"] / 2 + tp.IF["forge_mount"]["shoe"]["skin_mm"]
shoe_i, face_i = asm.place("hug_shoe", pid="shoe"), asm.place("hug_face", 0, 0, T, pid="face")
jc = next(c for c in hlib.parts["hug_face"]["connectors"] if c["id"] == "join")
cells = [(i, j) for i in range(jc["grid"]["nx"]) for j in range(jc["grid"]["ny"]) if [i, j] not in jc["grid"].get("omit_cells", [])]
pins = [asm.attach(hlib, face_i, "join", "join_pin", "axis", c, (0, 0), pid=f"pin{k}", dz=-5.0) for k, c in enumerate(cells)]
stack = [shoe_i, face_i] + pins + [asm.attach(hlib, face_i, "top_studs", "glow_capsule", "under_sockets", (0, 0), (0, 0), pid="glow")]
rh = asm.validate(hlib, stack)
test("assembled hugging mount: 4 pins join face and shoe, an add-on sits on top, nothing collides",
     rh["ok"] and sum(e.get("fit") == "friction" for e in rh["edges"]) == 2 * len(pins) == 8, str([x["code"] for x in rh["errors"]]))

# 7l. clip-on shoes for limbs and tails
clips = [hug_eval(line="shared", family="forge_shoe", size="pro", build={"face": "stud_small", "outline": "round", "outer_d": 64, "surface": "cylinder", "radius_mm": R, "clip": True})
         for R in (3, 5, 8, 12, 20, 30)]
CL = tp.IF["forge_mount"]["shoe"]["clip"]
test("clip-on shoes print without supports for limbs from 6 to 60 mm", all(e and e["design_status"] == "verified" for e in clips))
test("every clip wraps past halfway and its opening is narrower than the limb", all(e["hug"]["clip"]["wrap_deg"] > 180 and e["hug"]["clip"]["opening_mm"] < e["hug"]["clip"]["limb_d_mm"] for e in clips))
test("every clip's estimated snap strain is within the material limit", all(e["hug"]["clip"]["est_strain_pct"] <= CL["max_strain_pct"] for e in clips))
from manifold3d import Manifold  # noqa: E402


def limb_trapped(R):
    """Geometry, not metadata: the shoe really wraps the limb if the limb cannot drop out. Shift it down 1 mm and it must hit the clip's lips,
    while it sits in the shoe without touching it."""
    shoe = tp.forge_shoe(face="stud_small", outline="round", outer_d=64, surface="cylinder", radius_mm=R, clip=True)[0]
    limb = Manifold.cylinder(200, R, R, 192).rotate((0, 90, 0)).translate((-100, 0, -R))
    return (shoe ^ limb).volume() < 0.5 and (shoe ^ limb.translate((0, 0, -1.0))).volume() > 1.0


test("every clip really traps its limb (it sits free, and cannot drop out)", all(limb_trapped(R) for R in (3, 8, 20, 30)))
test("a limb too thin to clip is refused", hug_eval(line="shared", family="forge_shoe", size="pro", build={"face": "stud_small", "outline": "round", "outer_d": 64, "surface": "cylinder", "radius_mm": 1.0, "clip": True}) is None)
test("a round body cannot take a clip", hug_eval(line="shared", family="forge_shoe", size="pro", build={"face": "stud_small", "outline": "round", "outer_d": 64, "surface": "sphere", "radius_mm": 20, "clip": True}) is None)

# 7m. W5: wheels, hinge, cross connector, and parts on any axis
test("hinge: one pin through four interleaved knuckles from two leaves, measured as a turning fit",
     res["valid_hinge"]["ok"] and len(res["valid_hinge"]["edges"]) == 4 and all(abs(e["gap_min_mm"] - 0.2) < 0.01 for e in res["valid_hinge"]["edges"]))
ca = res["valid_cart_axle"]
test("cart: a horizontal axle drives through the cross connector and both wheels (press fits measured sideways)",
     ca["ok"] and sum(e.get("fit") == "press" for e in ca["edges"]) == 4 and all(abs(e["gap_min_mm"] - _flat_gap) < 0.01 for e in ca["edges"] if e.get("fit") == "press"))
test("an axle 2 mm off its bore is not connected", "floating" in codes("INVALID_axle_off_its_bore"))
test("a flat shaft rolled crosswise to a fixed bore is caught", bool({"collision", "fit_out_of_tolerance"} & (codes("INVALID_shaft_flats_crosswise") | {w["code"] for w in res["INVALID_shaft_flats_crosswise"]["warnings"]})))
test("a stud part cannot be tipped over", "unsupported_pose" in codes("INVALID_tipped_brick"))
test("horizontal bores print without supports (teardrop free bores, flat-topped fixed bores)",
     all(by_id[i]["design_status"] == "verified" for i in ("hinge_tu02", "cross_connector_tu01")))

# 7m2. W6 Racer wheel set
rw = res.get("valid_racer_wheels", {"ok": False, "edges": []})
test("racer wheels: axle turns in the block, both wheels press onto it, a plate sits on the block's studs",
     rw["ok"] and sum(e.get("fit") == "press" for e in rw["edges"]) == 2 and sum(e.get("fit") == "free" for e in rw["edges"]) == 1)

# 7n. calibration kit
import make_calibration as _mc
import numpy as _np
_snap = [_np.ptp(_np.asarray(p)[:, 0]) for p in _mc.snap_ladder().slice(4.0).to_polygons() if _np.ptp(_np.asarray(p)[:, 0]) > 5 and _np.ptp(_np.asarray(p)[:, 0]) < 20]
test("calibration kit prints without supports, and its Snap ladder steps 0.1 mm from the designed hole",
     _mc.main(out / "calibration", src=out) and len(_snap) == 8 and all(abs(b - a - 0.1) < 0.01 for a, b in zip(sorted(_snap), sorted(_snap)[1:]))
     and abs(sorted(_snap)[_mc.NOMINAL] - (tp.STUD["small"]["stud_d"] + tp.STUD["small"]["fit"])) < 0.01)
_fps = _mc.verify_first_print_selector()
test("first-print Forge Mount selector spans the PartSpec surface-offset window (-0.07 to +0.08 mm) across 1/2/3-dot sockets",
     _fps["ok"] and _fps["combined_window_mm"][0] <= -0.075 and _fps["combined_window_mm"][1] >= 0.08 and _fps["sockets"][1]["as_designed"])

# 7o. pre-print validator (synthetic fixtures, so the checks are proven whatever the catalog holds)
import preprint_check as _pc
import tempfile as _tf
import jsonschema as _js
from manifold3d import Manifold as _M
_prof = json.loads((HERE / "print_profiles" / "fdm_pla_0.4.json").read_text())
_tmp = Path(_tf.mkdtemp())
def _stl(name, m):
    f = _tmp / f"{name}.stl"
    tp.to_trimesh(m).export(f)
    return f
_box = _M.cube((20, 20, 10)).translate((-10, -10, 0))
_skin = _box - _M.cylinder(9.9, 5, 5, 64).translate((0, 0, -0.1))                    # blind hole leaving a 0.2 mm skin on top
_arch = (_M.cube((4, 10, 20)).translate((-14, -5, 0)) + _M.cube((4, 10, 20)).translate((10, -5, 0))
         + _M.cube((28, 10, 3)).translate((-14, -5, 20)) + _M.cylinder(15, 0.01, 3, 32).translate((0, 0, 5)))   # spike hanging from the arch
_r = {n: _pc.check_stl(_stl(n, m), _prof) for n, m in (("box", _box), ("skin", _skin), ("spike", _arch))}
_res = lambda n, cid: next(c["result"] for c in _r[n]["checks"] if c["id"] == cid)
test("pre-print: a plain box passes every geometry check", _r["box"]["verdict"] == "pass")
test("pre-print: a 0.2 mm skin over a hole is flagged as a thin wall", _res("skin", "V8_wall_thickness") == "warn")
test("pre-print: a spike hanging in mid-air is caught as a floating island", _res("spike", "V5_no_floating_islands") == "fail" and _r["spike"]["verdict"] == "fail")
_schema = json.loads((HERE / "validation_report.schema.json").read_text())
_saved = [json.loads(f.read_text()) for f in sorted((HERE / "validation").glob("*.json")) if f.name != "summary.json"]
test("pre-print: every saved report and the fixtures match the report schema",
     len(_saved) >= len([p for p in man["parts"] if p.get("file")]) and all(not list(_js.Draft202012Validator(_schema).iter_errors(r)) for r in _saved + list(_r.values())))
_sum = json.loads((HERE / "validation" / "summary.json").read_text())
# Judged per catalog part: validation/ also holds reports for printed parts outside the catalog (the Kip print connectors
# spark_peg_*, snap_turret*), which the asset optimizer reads for validated brims, so the total report count is not the catalog size.
_cat_ids = {p["id"] for p in man["parts"] if p.get("file")}
_sum_by_id = {r["part_id"]: r for r in _sum["parts"]}
test("pre-print: no catalog part fails the pre-print check, and every catalog part has a report",
     all(i in _sum_by_id and _sum_by_id[i]["verdict"] != "fail" for i in _cat_ids))

# 7p. stud-hole roofs (I7)
_hc = tp.socket_conn("small", 1, 1); _hc["style"] = "holes"
_pS = tp.STUD["small"]
_slab = lambda h: _M.cube((20, 20, h)).translate((-10, -10, 0)) - tp.cyl(_pS["stud_h"] + 0.4, (_pS["stud_d"] + _pS["fit"]) / 2, -0.01, 0, 0, 96)
test("roof check: a hole with 0.8 mm above its ceiling fails, one with 2 mm passes",
     not tp.hole_roof(_slab(_pS["stud_h"] + 0.4 + 0.8), [_hc])[0] and tp.hole_roof(_slab(_pS["stud_h"] + 0.4 + 2.0), [_hc])[0])
test("every integrated stud hole in the catalog is roofed (I7)",
     all(c["result"] == "pass" for e in man["parts"] for c in e.get("checks", []) if c["id"] == "I7_hole_roof")
     and sum(1 for e in man["parts"] for c in e.get("checks", []) if c["id"] == "I7_hole_roof") >= 15)

# 7q. app export (sets in the app's format, STL + GLB per part)
_ax = HERE / "app_export"
if (_ax / "sets" / "catalog.json").exists():
    _sch = json.loads((_ax / "set.schema.json").read_text())
    _v = _js.Draft202012Validator(_sch)
    _cat, _base = (json.loads((_ax / "sets" / f).read_text()) for f in ("catalog.json", "base.json"))
    _orig = json.loads((HERE / "app_input" / "base.json").read_text())
    _as = json.loads((_ax / "assets.json").read_text())["parts"]
    _racer = json.loads((_ax / "sets" / "forge-club-month1-racer.json").read_text())
    test("app export: every set and the app's own base.json pass the set schema",
         not list(_v.iter_errors(_cat)) and not list(_v.iter_errors(_base)) and not list(_v.iter_errors(_orig)) and not list(_v.iter_errors(_racer)))
    _sc = json.loads((_ax / "scenes" / "pro-gear-demo.json").read_text())
    test("app export: the Pro gear scene is a validated build with a 2 : 1 readout, and its GLB exists",
         _sc["validated"]["ok"] and _sc["readout"]["ratio"] == 2.0 and (_ax / _sc["glb"]).exists() and sum(n["spins"] for n in _sc["nodes"]) == 4)
    _cr = json.loads((_ax / "sets" / "forge-club-month2-critters.json").read_text())
    _sl = json.loads((_ax / "slots.json").read_text())["slots"]
    test("app export: the Critters set has six parts with six different stats, and passes the set schema",
         len(_cr["parts"]) == 6 and len({p["stat"]["name"] for p in _cr["parts"]}) == 6 and not list(_v.iter_errors(_cr)))
    test("app export: every character slot and vehicle slot has a part in a size on offer, with an anchor and a front",
         all(_sl["character"].get(k) for k in ("head", "back", "body", "top", "tail")) and all(_sl["vehicle"].get(k) for k in ("front", "rear", "hood", "roof", "wheels"))
         and all("anchorM" in _as[i]["attach"] and (_as[i]["attach"]["symmetric"] or _as[i]["attach"]["frontGlb"]) for k in _sl.values() for ids in k.values() for i in ids))
    _sp = next(p for p in _base["parts"] if p["id"] == "snap-spoiler-01")
    test("app export: the Racer set has its six add-ons and wheel set; the base Spoiler is the new printable one, with its app stat and skin",
         len(_racer["parts"]) == 9 and _sp["printable"] and _sp["stat"] == {"name": "speed", "value": 2} and _sp.get("skin") == "month1/racer-red"
         and _as["snap-spoiler-01"]["sourceId"] == "racer_spoiler")
    _parked = set((json.loads((HERE / "interfaces.json").read_text()).get("product", {}).get("parked") or {}).keys())
    import make_app_export as _ax_map
    _mpart = {p["id"]: p for p in man["parts"]}
    test("app export: every catalog part in a size on offer is exported once, with its STL and GLB; parked sizes are not",
         len(_cat["parts"]) == len([p for p in man["parts"] if p.get("file") and p["size_class"] not in _parked]) == len({p["id"] for p in _cat["parts"]})
         and ("large" not in _parked or not any(p["sizeClass"] == "large" for p in _cat["parts"] + _base["parts"]))
         and all((_ax / _as[p["id"]]["stl"]).exists() and (_ax / _as[p["id"]]["glb"]).exists() for p in _cat["parts"]))
    test("app export: the base set keeps every app id in a size on offer, in order, and nothing on the old grid is printable",
         [p["id"] for p in _base["parts"]] == [p["id"] for p in _orig["parts"] if p["sizeClass"] not in _parked
                                               and _mpart.get(_ax_map.BASE_MAP.get(p["id"]), {}).get("size_class") not in _parked]
         and all(not p["printable"] for p in _base["parts"] if _as[p["id"]].get("sourceId") is None))

# 7r. bridge versus ledge (P4 / V10): a flat underside must be held on both sides, or within 1 mm of support
import toyventor_ledge as _tl
_shelf = _M.cube((10, 10, 10)) + _M.cube((10, 6, 2)).translate((0, 10, 8))
_br16 = _M.cube((4, 10, 10)).translate((-12, 0, 0)) + _M.cube((4, 10, 10)).translate((8, 0, 0)) + _M.cube((24, 10, 2)).translate((-12, 0, 10))
_br24 = _M.cube((4, 10, 10)).translate((-16, 0, 0)) + _M.cube((4, 10, 10)).translate((12, 0, 0)) + _M.cube((32, 10, 2)).translate((-16, 0, 10))
_la = lambda m: _tl.ledges(tp.to_trimesh(m), m)[0]
test("ledges: a 6 mm shelf and a 24 mm bridge are caught; a 16 mm bridge between posts is not",
     _la(_shelf) > 40 and _la(_br24) > 100 and _la(_br16) == 0)
_rs = _pc.check_stl(_stl("shelf", _shelf), _prof)
test("pre-print: a one-sided ledge fails V10 and the verdict", next(c["result"] for c in _rs["checks"] if c["id"] == "V10_no_ledges") == "fail" and _rs["verdict"] == "fail")
test("every catalog part carries the ledge check and passes it (P4)",
     all(any(c["id"] == "P4_no_ledges" and c["result"] == "pass" for c in e.get("checks", [])) for e in man["parts"] if e.get("file")))

# 7s. Snap robot Bolt: five parts stack on studs, and its animated GLB is valid
rb = res.get("valid_robot_bolt", {"ok": False, "edges": []})
test("robot Bolt: legs, torso, arms, head and back pack stack on studs with no collisions", rb["ok"] and len(rb["edges"]) == 4)
if (HERE / "app_export" / "robots" / "bolt.json").exists():
    from pygltflib import GLTF2 as _G
    _bm = json.loads((HERE / "app_export" / "robots" / "bolt.json").read_text())
    _bg = _G().load(str(HERE / "app_export" / "robots" / "bolt.glb"))
    test("robot Bolt GLB: one node per part, four clips, validated build",
         _bm["validated"]["ok"] and len(_bm["parts"]) == 5 and [a.name for a in _bg.animations] == ["Idle", "Walk", "Jump", "Victory"]
         and sum(1 for n in _bg.nodes if n.mesh is not None) == 5)

# 7t. W9: Kip wardrobe & modular TU vehicles
w9_ids = [r["id"] for r in tp.CATALOG["parts"] if r.get("wave") == "W9"]
test("W9 Kip wardrobe and modular TU vehicles: all W9 parts are verified with zero blocking failures",
     len(w9_ids) >= 34 and all(by_id[i]["design_status"] == "verified" for i in w9_ids))
test("W9 modular vehicles mate cleanly with stylized wheels, snap-on covers, Wave 6 Racer add-ons and Wave 8 Snap characters",
     all(res[k]["ok"] and not res[k]["warnings"] for k in ("valid_kip_seated_wardrobe", "valid_kip_roadster_car", "valid_kip_hauler_truck", "valid_kip_motor_scooter", "valid_kip_sport_moto", "valid_kip_skateboard")))

# 7v. Universal face plate: FACE_DEPTH (the plate's front, back and the pocket floor are derived from it) must still match the three human heads,
# otherwise a head changed without the plate following and the plate could end up proud of the face.
_tab = tp.face_depth_table_from_heads()
_drift = max(abs(a - b) for ra, rb in zip(_tab, tp.FACE_DEPTH) for a, b in zip(ra, rb))
test("universal face plate: FACE_DEPTH matches the three human heads within 0.06 mm (the plate is never proud of a head)", _drift <= 0.06, f"max drift {_drift:.3f} mm; regenerate the table with tp.face_depth_table_from_heads()")

# 7u. W10, W11 & W13: Flat-pack modular craft kit-cards, Gate G1 pose/retention/seal sweeps, Pro rack steering, Momentum & Mech cores
import toyventor_kitcard as _kc
w10_ids = [r["id"] for r in tp.CATALOG["parts"] if r.get("wave") == "W10"]
w11_ids = [r["id"] for r in tp.CATALOG["parts"] if r.get("wave") == "W11"]
w13_ids = [r["id"] for r in tp.CATALOG["parts"] if r.get("wave") == "W13"]
test("W10 flat-pack modular craft: all 19 parts are verified and 100% clear the S1 small-parts cylinder",
     len(w10_ids) == 19 and all(by_id[i]["design_status"] == "verified" and by_id[i]["safety"]["small_part_status"] == "above_cylinder" for i in w10_ids))
test("W11 Pro steering & Momentum stored-energy cores: all 30 parts are verified with zero blocking failures",
     len(w11_ids) == 30 and all(by_id[i]["design_status"] == "verified" for i in w11_ids))
test("W13 Stage-4 PETG RC/Mech housings & couplers: all 11 parts are verified with zero blocking failures",
     len(w13_ids) == 11 and all(by_id[i]["design_status"] == "verified" for i in w13_ids))
_kn_l, _kn_l_conns, _ = _kc.pro_steer_knuckle_l()
_kn_pivots = [c for c in _kn_l_conns if c["id"] in ("kingpin_bore", "tierod_bore")]
test("knuckle cheek relief: 0.4 mm shave with pivot bores off-lattice but re-based with the body",
     abs(_kc.KNUCKLE_FACE_RELIEF - 0.4) < 1e-9 and len(_kn_pivots) == 2
     and all(c.get("lattice") == "pivot" for c in _kn_pivots)
     and all(abs(c["frame"]["origin"][2] - (6.25 - _kc.KNUCKLE_FACE_RELIEF)) < 1e-3 for c in _kn_pivots))
# Rack steering linkage: the shared constants must equal what the real parts say, so an edit to a knuckle, the rack or the bridge cannot
# silently desynchronise the closure, the link length, the guide wall and the stop.
_br, _br_conns, _ = _kc.pro_steer_bridge()
_kp_c = next(c for c in _br_conns if c["id"] == "kingpins")["frame"]["origin"]
_, _rk_conns, _ = _kc.pro_steer_rack()
_rk_o = _rk_conns[0]["frame"]["origin"]
_lk, _lk_conns, _lk_ex = _kc.pro_tie_rod_link()
_lk_stub = next(c for c in _lk_conns if c["id"] == "rack_stub")
_lk_bore = next(c for c in _lk_conns if c["id"] == "pivot_bore")
_kn_tr = next(c for c in _kn_l_conns if c["id"] == "tierod_bore")["frame"]["origin"]
_kn_kp = next(c for c in _kn_l_conns if c["id"] == "kingpin_bore")["frame"]["origin"]
_arm = abs(_kn_tr[0] - _kn_kp[0])
test("steering constants match the real parts: kingpin bores, rack tie-rod bores and knuckle arm radius",
     abs(abs(_kp_c[0]) - _kc.STEER_KP_X) < 1e-6 and abs(_kc.BRIDGE_Y + _kp_c[1] - _kc.STEER_KP_Y) < 1e-6
     and abs(_arm - _kc.STEER_ARM) < 1e-6 and abs(_rk_o[1] - _kc.RACK_BORE_DY) < 1e-6 and abs(abs(_rk_o[0]) - _kc.RACK_TIEROD_X) < 1e-6)
_link_need = math.hypot(_kc.STEER_KP_X - _kc.RACK_TIEROD_X, (_kc.STEER_KP_Y - _arm) - (_kc.RACK_Y + _rk_o[1]))
test("tie-rod link: stub-to-bore length is the rack-bore to knuckle-bore distance at straight ahead (15.468 mm), and the stub stays off the deck",
     abs(_lk_bore["frame"]["origin"][0] - _lk_stub["frame"]["origin"][0] - _link_need) < 1e-6 and abs(_link_need - _kc.TIEROD_LINK_MM) < 1e-6
     and _kc.LINK_STUB_MM <= _kc.RACK_T + _kc.LINK_LIFT - 0.3 and _lk_ex["print_rotation_deg"] == [180.0, 0.0, 0.0])
test("bridge deck is stud-free so the pinion and rack run 0.2 mm above it (the rear servo studs that held them 3 mm up are gone)",
     all(c["id"] != "top_studs" for c in _br_conns) and abs(_kc.RACK_Z - (_kc.DECK_Z + 0.2)) < 1e-9
     and abs(_br.bounding_box()[5] - (_kc.LINK_TOP_Z - _kc.BRIDGE_Z)) < 1e-6)
_g1 = _kc.verify_gate_g1()
test("Gate G1: all 9 canonical craft, 3-point rack capture & bi-directional pin lock, 55-deg dump tip, Momentum packs & 3D jet seal, and Stage-4 Mech COTS keep-outs pass",
     _g1["ok"] and len(_g1["crafts"]) == 13 and "1b_rack_travel_stop" in _g1["crafts"] and "2b_dump_truck_tip_sweep" in _g1["crafts"]
     and "3b_momentum_packs_and_jet_seal" in _g1["crafts"] and "3c_band_clutch_and_shaft_capture" in _g1["crafts"])
if (out / "cards" / "kitcard_manifest.json").exists():
    _kcm = json.loads((out / "cards" / "kitcard_manifest.json").read_text())["cards"]
    test("kit-card plates: all 8 loose and 8 sprue STLs exist within <= 170/164 mm bounds and >= 5.0 mm inter-part gap",
         len(_kcm) == 8 and all(
             (out / m["loose_stl"]).exists() and (out / m["sprue_stl"]).exists()
             and max(m["outer_mm"]) <= m["limit_mm"] and m["min_gap_mm"] >= 5.0
             for m in _kcm.values()
         ))
test("W10, W11 & W13 multi-stage craft builds (Race Car, Dump Truck, Helicopter, Pro Rack-Steered Racer, Momentum Band Truck, Stage-4 Mech RC Truck) validate cleanly",
     all(res[k]["ok"] and not res[k]["warnings"] for k in ("valid_kit_race_car", "valid_kit_dump_truck", "valid_kit_helicopter", "valid_pro_steered_racer", "valid_pro_tie_rod_link_on_rack", "valid_mom_band_truck", "valid_mech_rc_truck")))

# 8. generated instructions list every part and nothing third-party
agents = (out / "AGENTS.md").read_text() if (out / "AGENTS.md").exists() else ""
test("AGENTS.md lists every part", all(f"`{p['id']}`" in agents for p in parts))
banned = re.compile("|".join(["ste" + "mfie", "le" + "go", "du" + "plo", "mec" + "cano"]), re.I)
code = [f for f in HERE.glob("*.py") if f.name != "selftest.py"]
docs_root = HERE.parent.parent / "docs"
spec_docs = list((docs_root / "specs").glob("*.md")) + list((docs_root / "parts").rglob("*.md")) if docs_root.exists() else []
scan = [f for f in list(out.glob("*.md")) + list(out.glob("*.json")) + [HERE / "interfaces.json"] + code + spec_docs if banned.search(f.read_text())]
test("no third-party construction-system names in generated files or specs", not scan, str([f.name for f in scan]))

print(f"\n{len(FAILS)} failure(s)" if FAILS else "\nall tests passed")
sys.exit(1 if FAILS else 0)
