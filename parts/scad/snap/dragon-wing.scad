// snap-wing-01 "Dragon Wing" — matches sets/base.json (32x16 mm
// footprint, flat). Character add-on, original design: one swept wing
// on a 2x1 socket base, for a figure's back or a car roof.
//
// Prints flat, no supports: the wing is a vertical plate, so every
// column of the scalloped silhouette is filled from the base up and
// nothing overhangs. The 2x1 footprint is symmetric, so it snaps on
// either way round — there is no wrong way for a kid to attach it.
include <../profiles/stud_profile_small.scad>;

base_h = 8;
wing_t = 4;

// Wing silhouette in plan: x along the toy (0 = front root, 32 = rear),
// y up. Scallops dip along the trailing edge from the tip.
module wing_2d() {
  // Erode-then-grow rounds the convex corners (tip, scallop peaks)
  // to about r=1.2 so no point is sharp.
  offset(r = 1.2) offset(r = -1.2)
    polygon(points = [
      [2, 0], [30, 0], [30, 6], [27, 20], [20, 11],
      [15, 13], [10, 7], [5, 8],
    ]);
}

socket_plate(2, 1, base_h);

// Stand the silhouette upright at the back of the base, sunk 1 mm so
// the root is one piece with the plate. After the rotation the
// extrusion runs toward -Y, so y=13 puts the wing at y 9..13 with a
// 3 mm rim behind it. Measured STL height is about 25.4 mm: the
// r=1.2 corner rounding trims the 20 mm sketch peak.
translate([0, 13, base_h - 1])
  rotate([90, 0, 0])
    linear_extrude(height = wing_t)
      wing_2d();
