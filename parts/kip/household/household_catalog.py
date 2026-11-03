"""The household library catalog: 50 everyday objects, the words that map a child's word (or a scan's label) to each, and how each is built.
Source of truth for `public/kip/household/catalog.json`, whose build fields (triangles, bytes, zones, hash) `build_household.py` adds.

See docs/specs/household-library-spec.md. Standard library only, so it runs without the partspec venv:
    python3 parts/kip/household/household_catalog.py            # check and print a summary
    python3 parts/kip/household/household_catalog.py --json     # the static rows as JSON (what the drift test compares)

Family (how an item is built):  R revolve (one profile spun)   RC revolve plus a composite (handle, spout, stem)
                                E extruded or dished outline   C primitives (prisms, cylinders, cones)   L loft or hulled chain (organic)
Scan items are linked by their rank in tests/fixtures/scan-targets.json (the ranked list of things a child is likely to photograph), never by the
list's own wording, which can name a brand. `real_mm` is that list's longest side for a scan item; the seven garage and table items the list lacks
carry their own.
"""
from __future__ import annotations

import json
import re
import sys
from typing import Dict, List, Optional, Tuple

FAMILIES = ("R", "RC", "E", "C", "L")
TAGS = ("garage", "tool", "sharp-looking")
PROP_MIN_MM, PROP_MAX_MM = 40, 90  # a held prop is clamped to this range

# id, label, scan rank (None = added), real longest side in mm, family, words, tags, note
ITEMS: List[Tuple[str, str, Optional[int], int, str, List[str], List[str], str]] = [
    ("ball", "Ball", 6, 190, "R", ["ball", "football", "soccer ball", "beach ball"], [], "A stripe as a second colour zone."),
    ("mug", "Mug", 51, 95, "RC", ["mug", "cup", "coffee cup", "teacup", "coffee mug"], [], "Revolved body, opening, D handle."),
    ("water_bottle", "Water bottle", 52, 210, "R", ["bottle", "water bottle"], [], "Cap as a second colour zone."),
    ("flask", "Flask", 53, 200, "R", ["flask", "travel mug", "vacuum flask"], [], "Cap as a second colour zone."),
    ("drinking_glass", "Drinking glass", 54, 150, "R", ["glass", "drinking glass", "tumbler"], [], "Open top, shallow."),
    ("jam_jar", "Jam jar", 72, 150, "R", ["jar", "jam jar"], [], "Lid as a second colour zone."),
    ("soda_can", "Can", 70, 120, "R", ["can", "soda can", "tin can", "drink can"], [], "Plain: no label, no brand."),
    ("cookie_tin", "Cookie tin", 71, 150, "R", ["tin", "cookie tin", "biscuit tin"], [], ""),
    ("bowl", "Bowl", 97, 200, "R", ["bowl", "pet bowl", "food bowl", "cereal bowl"], [], "Shallow recess."),
    ("plate", "Plate", None, 250, "R", ["plate", "dish", "dinner plate"], [], "Added: the commonest table item the scan list lacks."),
    ("bucket", "Bucket", None, 280, "RC", ["bucket", "pail"], ["garage"], "Added (garage). Handle as a thin arc."),
    ("watering_can", "Watering can", 98, 250, "RC", ["watering can"], [], "Spout and handle."),
    ("potted_plant", "Potted plant", 80, 180, "RC", ["plant", "potted plant", "houseplant", "flower pot"], [], "Pot plus a few leaf lofts."),
    ("spinning_top", "Spinning top", 21, 60, "R", ["top", "spinning top"], [], "Spins in the game."),
    ("yo_yo", "Yo-yo", 20, 60, "R", ["yo-yo", "yoyo"], [], ""),
    ("flying_disc", "Flying disc", 22, 220, "R", ["flying disc", "disc", "throwing disc"], [], "Spins in the game."),
    ("marble", "Marble", 19, 16, "R", ["marble"], [], "Prop scale is larger than life so it can be held."),
    ("apple", "Apple", 73, 80, "RC", ["apple"], [], "Stem and leaf as colour zones."),
    ("orange", "Orange", 75, 80, "R", ["orange"], [], "Stem nub as a second colour zone."),
    ("lemon", "Lemon", 76, 90, "R", ["lemon", "lime"], [], ""),
    ("banana", "Banana", 74, 200, "L", ["banana"], [], "Stem as a second colour zone."),
    ("carrot", "Carrot", 78, 180, "L", ["carrot"], [], ""),
    ("avocado", "Avocado", 77, 120, "L", ["avocado"], [], ""),
    ("wooden_spoon", "Wooden spoon", 67, 180, "E", ["spoon", "wooden spoon", "cooking spoon", "ladle"], [], "Bowl dished."),
    ("fork", "Fork", 68, 190, "E", ["fork"], ["sharp-looking"], "Blunt tines (radius 1.6 mm or more)."),
    ("key", "Key", 58, 60, "E", ["key"], [], ""),
    ("comb", "Comb", 61, 180, "E", ["comb"], [], "Teeth wide enough to print (at least 1.6 mm)."),
    ("hairbrush", "Hairbrush", 60, 200, "E", ["hairbrush", "hair brush"], [], ""),
    ("toothbrush", "Toothbrush", 63, 190, "E", ["toothbrush", "tooth brush"], [], ""),
    ("paintbrush", "Paintbrush", 44, 180, "C", ["paintbrush", "paint brush", "brush"], [], "The bare word 'brush' goes here: hair and tooth brushes need their own word."),
    ("pencil", "Pencil", 33, 180, "C", ["pencil"], [], "Held by the eraser end. Ferrule and eraser as colour zones."),
    ("marker", "Marker", 32, 140, "C", ["marker", "felt tip", "felt-tip pen", "pen"], [], ""),
    ("crayon", "Crayon", 31, 180, "C", ["crayon", "crayons"], [], "One crayon, not the box."),
    ("eraser", "Eraser", 34, 60, "C", ["eraser", "rubber"], [], ""),
    ("ruler", "Ruler", 36, 300, "E", ["ruler"], [], "Tick marks as raised ribs."),
    ("scissors", "Scissors", 37, 180, "E", ["scissors"], ["sharp-looking"], "Blunt blades, loops left open as relief only."),
    ("glue_stick", "Glue stick", 38, 100, "C", ["glue stick", "glue"], [], ""),
    ("stapler", "Stapler", 43, 150, "C", ["stapler"], [], ""),
    ("tape_dispenser", "Tape dispenser", 46, 140, "C", ["tape", "tape dispenser"], [], ""),
    ("dice", "Dice", 41, 16, "C", ["dice", "die"], [], "Pips as shallow dimples."),
    ("toy_brick", "Toy brick", 3, 32, "C", ["brick", "building brick", "toy brick", "block"], [], "Studs match the Snap line; generic, no brand."),
    ("bubble_wand", "Bubble wand", 29, 160, "E", ["bubble wand", "bubble blower"], [], ""),
    ("toy_sword", "Toy sword", 50, 700, "E", ["sword", "toy sword"], ["sharp-looking"], "Blunt, rounded edge."),
    ("hammer", "Hammer", None, 300, "C", ["hammer", "mallet"], ["garage", "tool"], "Added (garage)."),
    ("screwdriver", "Screwdriver", None, 220, "C", ["screwdriver"], ["garage", "tool", "sharp-looking"], "Added (garage). Blunt tip."),
    ("pliers", "Pliers", None, 180, "E", ["pliers"], ["garage", "tool"], "Added (garage)."),
    ("flashlight", "Flashlight", None, 150, "RC", ["flashlight", "torch"], ["garage"], "Added (garage). Lens as a glow zone."),
    ("tape_measure", "Tape measure", None, 80, "RC", ["tape measure", "measuring tape"], ["garage", "tool"], "Added (garage)."),
    ("alarm_clock", "Alarm clock", 91, 120, "RC", ["clock", "alarm clock"], [], "Bells and feet as a composite."),
    ("desk_lamp", "Desk lamp", 92, 200, "RC", ["lamp", "desk lamp"], [], "Shade revolved, arm as a hulled chain."),
]

ID_RE = re.compile(r"^[a-z][a-z0-9_]*$")
# No brands: the part SDK's own filter (FORBIDDEN_BRAND_RE, applied again by the build) plus two product names the scan list uses.
AVOIDED_BRAND_RE = re.compile(
    r"\b(lego|duplo|technic|bionicle|meccano|playmobil|knex|k'nex|megabloks|mega\s*bloks|frisbee|thermos)\b",
    re.IGNORECASE,
)


def prop_mm(real_mm: int) -> int:
    """The size a held prop is drawn at: the real size, clamped to 40 to 90 mm."""
    return int(min(PROP_MAX_MM, max(PROP_MIN_MM, real_mm)))


def static_rows() -> List[dict]:
    return [
        {
            "id": iid, "label": label, "scanRank": rank, "realMm": real, "propMm": prop_mm(real),
            "family": family, "words": list(words), "tags": list(tags), "note": note,
        }
        for (iid, label, rank, real, family, words, tags, note) in ITEMS
    ]


def problems(rows: List[dict]) -> List[str]:
    """Every structural fault in a list of rows (empty when sound). Used by the build and, with deliberately broken rows, by the tests."""
    out: List[str] = []
    ids: Dict[str, int] = {}
    words: Dict[str, str] = {}
    ranks: Dict[int, str] = {}
    for r in rows:
        iid = r.get("id", "")
        if not ID_RE.match(iid):
            out.append(f"bad id {iid!r}")
        if iid in ids:
            out.append(f"duplicate id {iid}")
        ids[iid] = 1
        if not str(r.get("label", "")).strip():
            out.append(f"{iid}: no label")
        text = " ".join([iid, str(r.get("label", "")), str(r.get("note", "")), *[str(w) for w in r.get("words", [])]])
        hit = AVOIDED_BRAND_RE.search(text)
        if hit:
            out.append(f"{iid}: brand term {hit.group(0)!r}")
        if r.get("family") not in FAMILIES:
            out.append(f"{iid}: family {r.get('family')!r} is not one of {FAMILIES}")
        if not r.get("words"):
            out.append(f"{iid}: no words")
        for w in r.get("words", []):
            if w != w.strip().lower() or not w:
                out.append(f"{iid}: word {w!r} is not trimmed lower case")
            if w in words and words[w] != iid:
                out.append(f"word {w!r} is in both {words[w]} and {iid}")
            words[w] = iid
        for t in r.get("tags", []):
            if t not in TAGS:
                out.append(f"{iid}: unknown tag {t!r}")
        rank = r.get("scanRank")
        if rank is not None:
            if rank in ranks:
                out.append(f"scan rank {rank} is claimed by both {ranks[rank]} and {iid}")
            ranks[rank] = iid
        if r.get("propMm") != prop_mm(r.get("realMm", 0)):
            out.append(f"{iid}: propMm {r.get('propMm')} is not realMm {r.get('realMm')} clamped to {PROP_MIN_MM}..{PROP_MAX_MM}")
    return out


def main(argv: List[str]) -> int:
    if "--verify" in argv:  # python3 household_catalog.py --verify <catalog.json>: check the rows of a written catalog; exit 1 and print every fault
        doc = json.load(open(argv[argv.index("--verify") + 1]))
        found = problems(doc["items"])
        if len(doc["items"]) != 50:
            found.append(f"{len(doc['items'])} items, not 50")
        for p in found:
            print("PROBLEM:", p)
        print(f"{len(doc['items'])} items checked, {len(found)} problems")
        return 1 if found else 0
    rows = static_rows()
    bad = problems(rows)
    if "--json" in argv:
        json.dump(rows, sys.stdout, indent=1)
        print()
        return 1 if bad else 0
    for p in bad:
        print("PROBLEM:", p)
    fam: Dict[str, int] = {}
    for r in rows:
        fam[r["family"]] = fam.get(r["family"], 0) + 1
    print(f"{len(rows)} items, {sum(len(r['words']) for r in rows)} words, families {fam}, "
          f"{sum(1 for r in rows if r['scanRank'] is not None)} from the scan list, {sum(1 for r in rows if r['scanRank'] is None)} added")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
