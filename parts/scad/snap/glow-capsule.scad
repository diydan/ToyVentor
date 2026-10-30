// snap-glow-capsule-01 "Glow Star Capsule" — matches sets/base.json
// (32x32 mm footprint, flat). Function capsule: this printed shell is
// just a friendly dome; the glow itself lives in AR and the mini game
// (docs/snap.md). One color, no electronics, nothing to swallow.
//
// Prints flat, no supports: dome walls lean 35 degrees from vertical
// and the top nub is a cone into a hemisphere, so every layer is
// smaller than the one under it.
include <../profiles/stud_profile_small.scad>;

base_h = 8;

socket_plate(2, 2, base_h);

// Dome: hull between a wide short cylinder and a narrow one 10 mm up
// gives straight support-free walls (a sphere here would overhang).
translate([16, 16, base_h - 0.5])
  hull() {
    cylinder(d = 27, h = 1, $fn = 48);
    translate([0, 0, 10]) cylinder(d = 13, h = 1, $fn = 48);
  }

// Nub: cone shoulders the dome top into a hemisphere cap. The sphere's
// lower half sits inside the cone, so only the shrinking upper half
// prints. Top of the part is about z = 25.5 mm.
translate([16, 16, base_h + 10])
  cylinder(d1 = 13, d2 = 9, h = 3, $fn = 48);
translate([16, 16, base_h + 13])
  sphere(d = 9, $fn = 32);
