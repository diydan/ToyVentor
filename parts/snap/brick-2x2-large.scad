// snap-brick-2x2-large — matches sets/base.json (64x64 mm footprint,
// flat). Youngest-kid brick: one chunky piece a toddler can palm, big
// rounded corners, nothing small or loose. Behavior in AR/game mirrors
// the small brick; only the hand size changes. Prints flat, studs up,
// no supports.
include <../profiles/stud_profile_large.scad>;

body_h = 20;

union() {
  socket_plate(2, 2, body_h);
  top_studs(2, 2, body_h);
}
