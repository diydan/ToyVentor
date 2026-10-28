// forge-mount-first-print — the first Forge Mount a printer ever makes.
// One connected print, three pieces joined by 1.2 mm breakaway bridges:
//
//   [ Forge Mount 3x2 ]-tab-[ fit selector strip ]-tab-[ test brick ]
//
// The strip carries three compliant sockets underneath (1/2/3 dots on
// top = snug / standard / easy clearances, matching shared/calibration.ts).
// Break the test brick free, click it into each dotted socket, answer
// "which clicked best?" once in the app, break the strip off, keep the
// mount. Later mounts print plain (forge-mount.scad) using that offset.
//
// Prints flat, supports-free: sockets face the bed with cone roofs,
// studs point up. Overall footprint 88 x 48 mm.
include <../profiles/stud_profile_small.scad>;

selector_x = 52;          // strip starts after a 4 mm bridge gap
selector_w = 16;
selector_y = -8;          // 48 mm deep strip beside the 32 mm mount
selector_h = 8;
token_x = 72;

// 1. The mount itself.
stud_plate(3, 2);

// 2. Breakaway bridges (thin in z so a twist snaps them cleanly).
for (y = [4, 25])
  translate([48, y, 0]) cube([4, 3, 1.2]);
translate([selector_x + selector_w, 14.5, 0]) cube([4, 3, 1.2]);

// 3. Selector strip: three compliant sockets underneath, dots on top.
clearances = [0.05, 0.2, 0.35]; // snug, standard, easy (calibration.ts)
difference() {
  translate([selector_x, selector_y, 0]) cube([selector_w, 48, selector_h]);
  for (i = [0 : 2])
    translate([selector_x + selector_w / 2, selector_y + 8 + i * 16, -0.1])
      compliant_socket(clearances[i]);
}
for (i = [0 : 2])
  for (dot = [0 : i])
    translate([
      selector_x + 4 + dot * 4,
      selector_y + 3.5 + i * 16,
      selector_h,
    ]) cylinder(d = 2.2, h = 0.8, $fn = 16);

// 4. Test brick: a loose 1x1 stud token to try in each socket, then keep.
translate([token_x, 8, 0]) {
  cube([stud_pitch_mm, stud_pitch_mm, plate_height_mm]);
  translate([stud_pitch_mm / 2, stud_pitch_mm / 2, plate_height_mm - 0.5]) {
    cylinder(d1 = stud_diameter_mm + 2, d2 = stud_diameter_mm, h = 1.5, $fn = 32);
    translate([0, 0, 1.5]) stud();
  }
}
