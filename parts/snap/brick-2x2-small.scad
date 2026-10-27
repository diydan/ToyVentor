// snap-brick-2x2-small — matches sets/base.json (32x32 mm footprint,
// flat). The basic building brick: sockets underneath snap onto a Forge
// Mount or another brick, studs on top take the next part. Prints flat,
// studs up, no supports (socket roofs are 45-degree cones).
include <../profiles/stud_profile_small.scad>;

body_h = 12;

union() {
  socket_plate(2, 2, body_h);
  top_studs(2, 2, body_h);
}
