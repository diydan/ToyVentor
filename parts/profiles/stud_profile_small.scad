// stud_profile_small — TARGET values only. Nothing in Snap has been printed
// yet (Oct 27, 2026); clearance locks after the Day 4 calibration prints.
stud_pitch_mm = 16;
stud_diameter_mm = 9.5;
stud_height_mm = 5;
plate_height_mm = 4;

module stud() {
  cylinder(d = stud_diameter_mm, h = stud_height_mm, $fn = 32);
}

module stud_plate(units_x, units_y) {
  cube([units_x * stud_pitch_mm, units_y * stud_pitch_mm, plate_height_mm]);
  for (x = [0 : units_x - 1])
    for (y = [0 : units_y - 1])
      translate([(x + 0.5) * stud_pitch_mm, (y + 0.5) * stud_pitch_mm, plate_height_mm])
        stud();
}
