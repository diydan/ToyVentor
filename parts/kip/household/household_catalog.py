"""The household library catalog: 60 everyday objects (the first 50 and the next ten), the words that map a child's word (or a scan's label) to each, and how each is built.
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
    # the next ten (phase 5): plain boxes, a puzzle piece and the first soft things, all from the scan list
    ("board_game", "Board game", 23, 300, "C", ["board game", "boardgame", "game box"], [], "A box on its edge; the lid carries a four by four board as a second colour zone."),
    ("jigsaw", "Jigsaw piece", 24, 300, "E", ["puzzle", "jigsaw", "jigsaw puzzle", "puzzle piece"], [], "One edge piece stands for the puzzle: a flat bottom edge to hold, two knobs and a socket."),
    ("notebook", "Notebook", 39, 210, "C", ["notebook", "journal", "diary", "exercise book"], [], "Cover, pages and an elastic strap as colour zones."),
    ("book", "Book", 40, 220, "C", ["book", "hardback", "storybook", "story book", "picture book"], [], "Rounded spine; a plain label with no title."),
    ("playing_cards", "Playing cards", 42, 90, "C", ["card", "cards", "playing card", "playing cards", "deck of cards"], [], "A squared deck with one heart: a single card is too thin to hold."),
    ("pencil_case", "Pencil case", 47, 200, "C", ["pencil case", "pencil box", "pencil pouch"], [], "Zip and puller as a second colour zone."),
    ("soap", "Bar of soap", 65, 90, "C", ["soap", "bar of soap"], [], "Stands on its long edge; a plain oval, no lettering."),
    ("sponge", "Sponge", 66, 120, "C", ["sponge", "kitchen sponge", "scrubber"], [], "Lying flat, so the front shows the two layers and the holes."),
    ("cereal_box", "Cereal box", 69, 190, "C", ["cereal box", "cereal", "box"], [], "A plain box: window and band as colour zones, no print. The scan list's own word for it is the bare 'box'."),
    ("lunchbox", "Lunchbox", 90, 220, "C", ["lunchbox", "lunch box"], [], "Base, lid, and a latch and handle as the third zone."),
]
ITEM_COUNT = 60  # the first 50 (phases 2 and 3) and the next ten (phase 5): the checker refuses a catalog with any other number

# ---- the age rule (Dan, 2026-11-03: "limit based on age", the engine's six bands in src/lib/age.ts: 0 = 2-3, 1 = 3-4, 2 = 5-6, 3 = 7-9, 4 = 10-12, 5 = 13+) ----
# Bands 0 and 1: no sharp-looking item and no real tool (garage item); the support tool stands in for any tool job. Band 2: blunt tools (the garage
# items) are allowed, sharp-looking ones are not; the support tool still stands in for the rest. Band 3 and up: every item, and the support tool stops.
# A tool job needs 1, 2 or 3 different real tools in bands 2, 3, and 4-5 (the Garage reads that; it is not catalog data).
BAND_SHARP, BAND_TOOL = 3, 2
SUPPORT_LAST_BAND = 2  # the support tool is offered, and stands in for tool jobs, up to this band


def min_band(tags: List[str]) -> int:
    """The youngest age band an item is shown to, from its tags."""
    if "sharp-looking" in tags:
        return BAND_SHARP
    if "garage" in tags or "tool" in tags:
        return BAND_TOOL
    return 0


# Household groups (a hand-written column, one line per group): the shape game takes its wrong answers from the right one's group first. This is NOT the
# `family` column, which says how an item is built (revolve, extrude, ...), not what it is.
GROUP_NAMES = ("cutlery", "kitchen", "containers", "fruit", "tools", "stationery", "toys", "bath", "home")
GROUPS: Dict[str, str] = {
    **{i: "cutlery" for i in ("wooden_spoon", "fork")},
    **{i: "kitchen" for i in ("plate", "bowl", "mug", "drinking_glass", "jam_jar", "soda_can", "cookie_tin", "water_bottle", "flask", "cereal_box")},
    **{i: "containers" for i in ("bucket", "watering_can", "potted_plant", "lunchbox", "pencil_case")},
    **{i: "fruit" for i in ("apple", "orange", "lemon", "banana", "carrot", "avocado")},
    **{i: "tools" for i in ("hammer", "screwdriver", "pliers", "flashlight", "tape_measure", "support_tool")},
    **{i: "stationery" for i in ("pencil", "marker", "crayon", "paintbrush", "eraser", "ruler", "scissors", "glue_stick", "stapler", "tape_dispenser", "notebook", "book")},
    **{i: "toys" for i in ("ball", "spinning_top", "yo_yo", "flying_disc", "marble", "toy_brick", "toy_sword", "bubble_wand", "dice", "board_game", "jigsaw", "playing_cards")},
    **{i: "bath" for i in ("toothbrush", "hairbrush", "comb", "soap", "sponge")},
    **{i: "home" for i in ("alarm_clock", "desk_lamp", "key")},
}

# Items that read at a glance for ages 2 to 4: a plain rounded or chunky shape, one or two colours, nothing fine. They are the pool the youngest
# bands pick between ("which one is the ball?", by picture). My choice from the pictures; edit the list, the tests keep it honest (never a tool, never
# sharp-looking, at most two colour zones).
SIMPLE_IDS = frozenset({
    "ball", "mug", "water_bottle", "drinking_glass", "bowl", "plate", "orange", "banana", "carrot", "lemon", "wooden_spoon", "toothbrush",
    "crayon", "soap", "sponge", "toy_brick", "yo_yo", "flying_disc", "cookie_tin", "marble",
})

# The support tool (outside the 60, never matched by a word): one chunky, rounded multi-purpose toy tool that stands in for any tool job in the
# youngest bands. id, label, real mm, family, note.
SUPPORT_ITEMS: List[Tuple[str, str, int, str, str]] = [
    ("support_tool", "Toy tool", 150, "RC", "A chunky mallet head with a gear on the front: stands in for any tool job in bands 0 to 2. No words: never matched."),
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
            "minBand": min_band(list(tags)), "simple": iid in SIMPLE_IDS, "group": GROUPS.get(iid),
        }
        for (iid, label, rank, real, family, words, tags, note) in ITEMS
    ]


def support_rows() -> List[dict]:
    """The support tool(s): a row like an item's, with no words and no scan rank, shown from band 0 up to SUPPORT_LAST_BAND."""
    return [
        {
            "id": iid, "label": label, "scanRank": None, "realMm": real, "propMm": prop_mm(real),
            "family": family, "words": [], "tags": [], "note": note,
            "minBand": 0, "maxBand": SUPPORT_LAST_BAND, "simple": True, "group": GROUPS.get(iid),
        }
        for (iid, label, real, family, note) in SUPPORT_ITEMS
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
        if r.get("group") not in GROUP_NAMES:
            out.append(f"{iid}: group {r.get('group')!r} is not one of {GROUP_NAMES}")
        want = min_band(list(r.get("tags", [])))
        if r.get("minBand") != want:
            out.append(f"{iid}: minBand {r.get('minBand')!r} is not {want}, what its tags ({', '.join(r.get('tags', [])) or 'none'}) give")
        if not isinstance(r.get("simple"), bool):
            out.append(f"{iid}: simple must be true or false")
        elif r["simple"] and want != 0:
            out.append(f"{iid}: a simple item (for the youngest bands) cannot be tagged {', '.join(r.get('tags', []))}")
    return out


def group_problems(rows: List[dict]) -> List[str]:
    """No group holds a single item (the shape game needs a same-group wrong answer to draw from)."""
    counts: Dict[str, int] = {}
    for r in rows:
        counts[r.get("group")] = counts.get(r.get("group"), 0) + 1
    return [f"group {g!r} holds {n} item: a group needs at least two" for g, n in sorted(counts.items(), key=lambda kv: str(kv[0])) if n < 2]


def support_problems(rows: List[dict]) -> List[str]:
    """What is wrong with the support tool rows: they are items that are never matched, so no words and no scan rank, and an age range from band 0."""
    out = [p for p in problems(rows) if "no words" not in p and "minBand" not in p and "simple item" not in p]
    for r in rows:
        iid = r.get("id", "")
        if r.get("words"):
            out.append(f"{iid}: a support tool has no words (it is never matched)")
        if r.get("scanRank") is not None:
            out.append(f"{iid}: a support tool has no scan rank")
        if r.get("minBand") != 0 or r.get("maxBand") != SUPPORT_LAST_BAND:
            out.append(f"{iid}: a support tool is shown in bands 0 to {SUPPORT_LAST_BAND}, not {r.get('minBand')} to {r.get('maxBand')}")
    return out


def main(argv: List[str]) -> int:
    if "--verify" in argv:  # python3 household_catalog.py --verify <catalog.json>: check the rows of a written catalog; exit 1 and print every fault
        doc = json.load(open(argv[argv.index("--verify") + 1]))
        found = problems(doc["items"]) + group_problems(doc["items"])
        support = doc.get("support")
        if not support:
            found.append("no support tool")
        else:
            found += support_problems(support)
        if len(doc["items"]) != ITEM_COUNT:
            found.append(f"{len(doc['items'])} items, not {ITEM_COUNT}")
        for p in found:
            print("PROBLEM:", p)
        print(f"{len(doc['items'])} items checked, {len(found)} problems")
        return 1 if found else 0
    rows = static_rows()
    bad = problems(rows) + group_problems(rows)
    if "--json-support" in argv:
        json.dump(support_rows(), sys.stdout, indent=1)
        print()
        return 0 if not support_problems(support_rows()) else 1
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
