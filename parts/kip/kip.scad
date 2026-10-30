// ============================================================================
// ToyVentor Main Character — "Kip" (Modular Blank-Canvas Art-Toy Rig)
// 100% Original Clean-Room Parametric Geometry on the 12.5 mm TU Standard
// Editions: Pro (8+) 14-DOF & Snap (3+) 10-DOF (16 CFR 1500.19 small-parts warning)
// ============================================================================

// Select which part to export via -D 'PART="head_shell"'
PART = "head_shell";

// Set -D 'PRINT_ORIENT=true' to place any part flat on z = 0 in its support-free print pose.
// Leave false (default) to export in Kip's assembly/viewer coordinate frame.
PRINT_ORIENT = false;

// --- ToyVentor Interface Standard (from parts/partspec/interfaces.json) ---
TU          = 12.5;
STUD_D      = 6.6;
STUD_H      = 2.8;
STUD_FIT    = 0.1;
SOCKET_D    = STUD_D + STUD_FIT; // 6.7 mm
PRO_FREE_D  = 7.0;
PRO_SHAFT_D = 6.6;

// --- Character Master Dimensions (Pro Standing Height = 150.0 mm = 12.0 TU) ---
HEAD_W      = 44.0;
HEAD_D      = 38.0;
HEAD_H      = 41.5;

PEG_BIG_D   = 9.0;   // Neck, Shoulders, Hips
PEG_SML_D   = 8.0;   // Elbows, Wrists, Knees, Ankles
SOCK_CLR    = 0.15;  // Radial socket clearance

$fn = 84;

// ============================================================================
// Helper Primitives
// ============================================================================

// ToyVentor Standard Small Stud (6.6 x 2.8 mm above z=0, with optional root_sink below z=0)
module tv_stud(root_sink = 0.0) {
    r = STUD_D / 2;
    f = 0.6;
    rotate_extrude($fn = 96) {
        polygon([
            [0, -root_sink],
            [r, -root_sink],
            [r, STUD_H - f],
            for (i = [1:6])
                let(a = 90 * i / 6)
                [r - f + f * cos(a), STUD_H - f + f * sin(a)],
            [0, STUD_H]
        ]);
    }
}

// ToyVentor Support-Free Integrated Stud Socket Cutter (z=0 opening, 42 deg cone roof)
module tv_socket_cut(depth = 3.4) {
    r = SOCKET_D / 2;
    union() {
        translate([0, 0, -0.2])
            cylinder(h = 0.9, r1 = r + 0.5, r2 = r, $fn = 96);
        translate([0, 0, 0])
            cylinder(h = depth, r = r, $fn = 96);
        translate([0, 0, depth - 0.01])
            cylinder(h = r * 1.05, r1 = r, r2 = 0, $fn = 96);
    }
}

// Support-Free Outsole Edge Stud-Relief Cutter (45 deg cone ceiling, clears neighbouring plate studs)
module tv_stud_relief_cut(depth = 3.2) {
    r = SOCKET_D / 2 + 0.2; // 3.55 mm radial clearance
    union() {
        translate([0, 0, -0.2])
            cylinder(h = depth + 0.2, r = r, $fn = 72);
        translate([0, 0, depth - 0.01])
            cylinder(h = r, r1 = r, r2 = 0, $fn = 72);
    }
}

// Support-Free Internal Ball-Peg Socket Cutter (opens at z=0, <=38 deg conical ceiling)
module ball_socket_cut(d = PEG_BIG_D, embed = 4.6, outward_clear = 0) {
    rc = d / 2 + SOCK_CLR;
    ro = d * 0.43; // snap undercut retention lip
    union() {
        // Optional outward access clearance through curved shoulder walls
        if (outward_clear > 0) {
            translate([0, 0, -outward_clear])
                cylinder(h = outward_clear, r = rc + 0.5, $fn = 72);
        }
        // Lead-in chamfer at mouth
        translate([0, 0, -0.2])
            cylinder(h = 1.2, r1 = rc + 0.5, r2 = ro, $fn = 72);
        // Throat into sphere
        translate([0, 0, 0.9])
            cylinder(h = embed - 0.9, r1 = ro, r2 = rc, $fn = 72);
        // Spherical seat
        translate([0, 0, embed])
            sphere(r = rc, $fn = 72);
        // 38-degree supportless conical ceiling tangent to sphere
        z_tan = embed + rc * sin(38);
        r_tan = rc * cos(38);
        translate([0, 0, z_tan])
            cylinder(h = r_tan / tan(38), r1 = r_tan, r2 = 0, $fn = 72);
    }
}

// ToyVentor Pro 50-deg Teardrop Horizontal Bore Cutter (+Y_2d points toward +Z_world ceiling!)
module teardrop_2d(d) {
    r = d / 2;
    apex = r / cos(50);
    hull() {
        circle(r = r, $fn = 84);
        translate([0, apex])
            circle(r = 0.05, $fn = 16);
    }
}

// Extruded teardrop blind/through bore starting at z=0 into +Z (with 45-deg mouth chamfer)
module pro_teardrop_bore_cut(d = PRO_FREE_D, depth = 12.8, ch = 0.55) {
    s_ch = (d + 2 * ch) / d;
    union() {
        hull() {
            translate([0, 0, -0.2])
                linear_extrude(height = 0.2)
                    scale([s_ch, s_ch]) teardrop_2d(d);
            translate([0, 0, ch])
                linear_extrude(height = 0.05)
                    teardrop_2d(d);
        }
        linear_extrude(height = depth)
            teardrop_2d(d);
    }
}

// Support-Free ~38-deg Conical Cosmetic V-Groove Ring (eliminates 90-deg groove overhangs)
module v_groove_ring(z_mid, r_outer, r_inner, sy = 1.0) {
    dr = r_outer - r_inner;
    hh = dr * tan(38); // <= 38 deg flank slope!
    translate([0, 0, z_mid])
        scale([1.0, sy, 1.0])
            difference() {
                cylinder(h = 2 * hh + 0.4, r = r_outer + 0.8, center = true, $fn = 84);
                union() {
                    translate([0, 0, 0])
                        cylinder(h = hh, r1 = r_inner, r2 = r_outer, $fn = 84);
                    translate([0, 0, -hh])
                        cylinder(h = hh, r1 = r_outer, r2 = r_inner, $fn = 84);
                    translate([0, 0, hh - 0.01])
                        cylinder(h = 1.0, r = r_outer + 1.0, $fn = 84);
                    translate([0, 0, -hh - 0.99])
                        cylinder(h = 1.0, r = r_outer + 1.0, $fn = 84);
                }
            }
}

// Superellipse Head Shell 2D Profile (r, z) for revolve, offset by d
function head_prof_pts(d = 0) =
    let(
        R  = HEAD_W / 2 + d,
        R0 = 15.2 + d * 0.85,
        H  = HEAD_H + d,
        z1 = 10.5,   // smooth lower flare (< 38 deg)
        z2 = 23.5,   // vertical-ish sweet spot for visor & ear pods
        p  = 2.35    // soft art-toy dome (rounder than cylinder, crisper than sphere)
    )
    concat(
        [[0, max(0, -d)], [R0 - 0.8, max(0, -d)], [R0, 0.8]],
        [for (k = [1:16])
            let(t = k / 16)
            [R0 + (R - R0) * sin(90 * t), 0.8 + (z1 - 0.8) * t]
        ],
        [for (k = [1:8])
            let(t = k / 8)
            [R, z1 + (z2 - z1) * t]
        ],
        [for (k = [1:24])
            let(t = k / 24, u = pow(max(0, 1 - pow(t, p)), 1 / p))
            [R * u, z2 + (H - z2) * t]
        ],
        [[0, H]]
    );

module head_solid(d = 0) {
    scale([1.0, HEAD_D / HEAD_W, 1.0])
        rotate_extrude($fn = 112)
            polygon(head_prof_pts(d));
}

// Chamfered Visor Octagon Profile in (x, z)
module visor_2d(w, h, c, r_round = 1.6) {
    cz = c * 1.15;
    offset(r = r_round, $fn = 36)
        offset(r = -r_round, $fn = 36)
            polygon([
                [-w/2 + c, -h/2],
                [ w/2 - c, -h/2],
                [ w/2,     -h/2 + cz],
                [ w/2,      h/2 - cz],
                [ w/2 - c,  h/2],
                [-w/2 + c,  h/2],
                [-w/2,      h/2 - cz],
                [-w/2,     -h/2 + cz]
            ]);
}

module visor_cutter(w = 30.0, h = 18.5, c = 4.2, zc = 19.0) {
    translate([0, 0, zc])
        rotate([90, 0, 0])
            linear_extrude(height = 35, center = false)
                visor_2d(w, h, c);
}

// Rounded Pill Box in 3D
module pill_box(w, d, h, r) {
    hull() {
        for (sx = [-1, 1], sy = [-1, 1]) {
            translate([sx * (w/2 - r), sy * (d/2 - r), 0])
                cylinder(h = h, r = r, $fn = 48);
        }
    }
}

// Smooth Sculpted Loft along Z from list of [z, rx, ry], flush at exact slices[0][0]..slices[last][0]!
module loft_ellipses(slices) {
    n = len(slices);
    for (i = [0 : n - 2]) {
        s0 = slices[i];
        s1 = slices[i + 1];
        z0 = (i == 0)     ? s0[0]        : s0[0] - 0.01;
        z1 = (i == n - 2) ? s1[0] - 0.02 : s1[0] - 0.01;
        hull() {
            translate([0, 0, z0])
                scale([s0[1], s0[2], 1])
                    cylinder(h = 0.02, r = 1, center = false, $fn = 84);
            translate([0, 0, z1])
                scale([s1[1], s1[2], 1])
                    cylinder(h = 0.02, r = 1, center = false, $fn = 84);
        }
    }
}

// ============================================================================
// 1. HEAD ASSEMBLY (z_local = 0..41.5, placed at z_world = 108.5)
// ============================================================================

module part_head_shell() {
    difference() {
        head_solid(0);

        // Trim hidden top cap at z = 39.1 so head_hood's crown mortise has a solid >= 1.3 mm floor
        translate([-25, -25, 39.1])
            cube([50, 50, 10]);

        // Recessed Visor Pocket (1.62 mm step with clean bezel frame & 0.10 mm floor clearance for visor)
        intersection() {
            difference() {
                head_solid(2.0);
                head_solid(-1.62);
            }
            visor_cutter(30.4, 18.8, 4.3, 19.2);
        }

        // Outer Bezel Groove Line (overlaps 0.6 mm into pocket; top at z=29.44 avoids z=29.5 latitude seam!)
        intersection() {
            difference() {
                head_solid(0.5);
                head_solid(-0.45);
            }
            difference() {
                visor_cutter(32.2, 20.48, 4.8, 19.2);
                visor_cutter(29.8, 18.2, 4.1, 19.2);
            }
        }

        // Ear-Pod Side Seats (x = +-22, z = 20.0, 50-deg teardrop roof for clean horizontal print!)
        for (sx = [-1, 1]) {
            translate([sx * (HEAD_W/2 + 2.0), 0, 20.0])
                rotate([0, -sx * 90, 0])
                    rotate([0, 0, sx == 1 ? 90 : -90])
                        pro_teardrop_bore_cut(11.6, 4.2, 0.3);
        }

        // Neck Ball-Peg Socket at z=0
        ball_socket_cut(PEG_BIG_D, 4.8);
    }
}

module part_head_hood() {
    // Sculpted helmet hood with S-scoops around ear pods & 1.2 mm crown mortise lock
    difference() {
        union() {
            difference() {
                head_solid(1.25);
                intersection() {
                    head_solid(0.04);
                    translate([-30, -30, -2]) cube([60, 60, 41.35]);
                }

                // Cut away lower chin/neck below z = 9.5
                translate([0, 0, -5])
                    cylinder(h = 14.5, r1 = 35, r2 = 35, $fn = 84);

                // Cut away front visor opening generously around bezel
                visor_cutter(33.2, 21.8, 5.2, 19.2);
                // Open lower front chin below visor
                translate([-18, -30, 0])
                    cube([36, 22, 19.2]);

                // Signature S-Scoop Cutouts around Left & Right Ear Pods
                for (sx = [-1, 1]) {
                    hull() {
                        translate([sx * 24, 0, 20.0])
                            rotate([0, sx * 90, 0])
                                cylinder(h = 14, r = 7.6, center = true, $fn = 72);
                        translate([sx * 24, -6.5, 11.0])
                            rotate([0, sx * 90, 0])
                                cylinder(h = 14, r = 6.5, center = true, $fn = 72);
                    }
                }
            }

            // Flat Crown Dock Boss on top (houses 1.2 mm press-fit mortise for crown_buds / crown_cap_blank)
            intersection() {
                head_solid(3.2);
                translate([0, 0, 35.8])
                    hull() {
                        translate([0, 0, 0])   pill_box(27.6, 15.6, 0.1, 6.0);
                        translate([0, 0, 6.0]) pill_box(24.8, 13.2, 0.2, 5.2);
                    }
            }
        }

        // Inner clearance matching trimmed head_shell (leaves 1.25 mm solid floor z = 39.15..40.40!)
        intersection() {
            head_solid(0.04);
            translate([-30, -30, -2])
                cube([60, 60, 41.15]);
        }

        // Trim flat horizontal top rim at z = 41.6
        translate([-30, -30, 41.6])
            cube([60, 60, 10]);

        // 1.2 mm-deep press-fit Crown Mortise Pocket (0.08 mm per-side clearance around 22.4 x 10.8 tenon)
        translate([0, 0, 40.4])
            pill_box(22.56, 10.96, 2.0, 4.88);
    }
}

module part_crown_buds() {
    // Two #FF6B4A Spark Crown Studs on a solid 1.8 mm mortise-tenon pill base (x = +-6.25 mm)
    // Studs sink 0.5 mm into the pill base so the mesh is 100% single-body watertight, emerging at z = 42.2!
    union() {
        translate([0, 0, 40.4])
            pill_box(22.4, 10.8, 1.8, 4.8);
        for (sx = [-1, 1]) {
            translate([sx * (TU / 2), 0, 42.2])
                tv_stud(root_sink = 0.5);
        }
    }
}

module part_crown_cap_blank() {
    // Smooth dome cap with matching 22.4 x 10.8 tenon (snaps cleanly into head_hood's crown mortise!)
    union() {
        translate([0, 0, 40.4])
            pill_box(22.4, 10.8, 1.3, 4.8);
        intersection() {
            translate([0, 0, 0.5]) head_solid(2.2);
            translate([0, 0, 41.6])
                pill_box(22.4, 10.8, 4.0, 4.8);
        }
    }
}

module part_ear_pod(side = 1) {
    // Stepped concentric 40-deg pivot pod + functional Ø 6.6 mm Snap/Pro center boss!
    translate([side * (HEAD_W / 2 - 1.2), 0, 20.0])
        rotate([0, side * 90, 0]) {
            union() {
                // Base plug into head shell
                cylinder(h = 1.6, r = 5.65, $fn = 84);
                // Outer stepped ring (40-deg conical flank)
                translate([0, 0, 1.5])
                    cylinder(h = 1.6, r1 = 6.2, r2 = 5.0, $fn = 84);
                // Functional Ø 6.6 x 2.8 mm Snap/Pro stud boss (sunk 0.4 mm for watertight union)
                translate([0, 0, 3.0])
                    tv_stud(root_sink = 0.4);
            }
        }
}

module part_visor() {
    // Curved conformal swap-in faceplate (1.42 mm thick) sitting with 0.10 mm clearance inside visor pocket
    intersection() {
        difference() {
            head_solid(-0.10);
            head_solid(-1.52);
        }
        visor_cutter(29.8, 18.2, 4.1, 19.2);
    }
}

module part_face_eyes() {
    // Low-and-wide expressive eyes (z = 17.0, x = +-7.6) with conical flanks
    intersection() {
        difference() {
            head_solid(0.55);
            head_solid(-0.65);
        }
        union() {
            for (sx = [-1, 1]) {
                translate([sx * 7.6, -15, 17.0])
                    rotate([90, 0, sx * 12])
                        scale([1.0, 1.08, 1.0])
                            cylinder(h = 12, r1 = 3.2, r2 = 2.35, center = true, $fn = 64);
            }
        }
    }
}

module part_face_glints() {
    // Crisp white eye glints
    intersection() {
        difference() {
            head_solid(0.78);
            head_solid(-0.45);
        }
        union() {
            for (sx = [-1, 1]) {
                translate([sx * 8.35, -15, 18.05])
                    rotate([90, 0, sx * 12])
                        cylinder(h = 12, r = 0.82, center = true, $fn = 36);
                translate([sx * 6.85, -15, 16.05])
                    rotate([90, 0, sx * 12])
                        cylinder(h = 12, r = 0.42, center = true, $fn = 28);
            }
        }
    }
}

module part_face_cheeks() {
    // Coral Spark (#FF6B4A) low-wide pill blushes
    intersection() {
        difference() {
            head_solid(0.45);
            head_solid(-0.75);
        }
        union() {
            for (sx = [-1, 1]) {
                translate([sx * 11.4, -14, 14.3])
                    rotate([90, 0, sx * 20])
                        hull() {
                            translate([-0.7, 0, 0]) cylinder(h = 12, r = 1.05, center = true, $fn = 36);
                            translate([ 0.7, 0, 0]) cylinder(h = 12, r = 1.05, center = true, $fn = 36);
                        }
            }
        }
    }
}

// ============================================================================
// 2. SCULPTED ONE-PIECE TORSO + PELVIS + 2x2 TU BACK DOCK (z_world = 57.5..105.5)
// ============================================================================

// Shared support-free Back Dock Mortise + 1 TU Central Teardrop Bore (z=87.5) + 2 TU Tail Port (z=62.5)
module back_and_tail_port_cuts() {
    // 1.2 mm-deep Back Dock Mortise Pocket (y = 12.2..13.4) with 45-deg beveled top edge so zero ledge forms!
    hull() {
        translate([0, 12.2, 87.5])
            rotate([-90, 0, 0])
                pill_box(24.16, 24.16, 0.05, 3.88);
        translate([0, 13.45, 88.1])
            rotate([-90, 0, 0])
                pill_box(24.16, 25.36, 0.2, 3.88);
    }

    // Central 12.8 mm-deep (>= 1 TU!) Ø 7.0 mm 50-deg Teardrop Pro Bore at z = 87.5
    translate([0, 13.4, 87.5])
        rotate([90, 0, 0])
            pro_teardrop_bore_cut(PRO_FREE_D, 13.2, 0.55);

    // Lower-Back Tail Port at exact z = 62.5 mm (2.0 TU = 25.0 mm below z = 87.5!):
    // 12.8 mm-deep (>= 1 TU!) Ø 7.0 mm 50-deg Teardrop Pro Bore (mates real pin_friction + tail_acc!)
    translate([0, 13.1, 62.5])
        rotate([90, 0, 0])
            pro_teardrop_bore_cut(PRO_FREE_D, 12.8, 0.55);
}

module part_torso() {
    difference() {
        union() {
            // Smooth organic capsule torso + rounded pelvis
            loft_ellipses([
                [ 57.5,  7.5,  6.5],
                [ 59.5, 13.5, 10.6],
                [ 64.0, 15.8, 12.0],  // Hip fullness
                [ 71.0, 14.6, 11.2],  // Subtle art-toy waist taper
                [ 80.0, 15.8, 12.0],  // Lower chest
                [ 92.0, 17.2, 12.8],  // Sculpted upper chest
                [ 99.5, 15.8, 11.6],  // Shoulder rounding
                [103.5, 11.0,  9.2],  // Collar taper
                [105.5,  7.8,  7.2]   // Neck collar rim
            ]);

            // Integrated Back Dock Boss (flat rear mounting pad at y = +13.4, centered at z = 87.5)
            hull() {
                translate([0, 8.8, 86.2])
                    rotate([-90, 0, 0])
                        pill_box(28.4, 29.8, 0.2, 5.4);
                translate([0, 12.8, 87.5])
                    rotate([-90, 0, 0])
                        pill_box(26.8, 26.8, 0.6, 4.4);
            }

            // Lower-Back Tail Boss at exact z = 62.5 mm (2.0 TU below Back Dock, stays >= z = 57.6 mm!)
            hull() {
                translate([0, 9.2, 62.5])
                    rotate([-90, 0, 0])
                        cylinder(h = 0.2, r = 4.9, $fn = 56);
                translate([0, 12.6, 62.5])
                    rotate([-90, 0, 0])
                        cylinder(h = 0.5, r = 4.9, $fn = 56);
            }
        }

        // Subtle Waist Band V-Groove (~38 deg support-free flanks!)
        v_groove_ring(70.5, 15.2, 14.1, 0.76);

        // Top Neck Ball-Peg Socket
        translate([0, 0, 105.5])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_BIG_D, 4.6);

        // Left & Right Shoulder Sockets (punches cleanly out through shoulder wall, 100% 1-body!)
        for (sx = [-1, 1]) {
            translate([sx * 15.0, 0, 95.5])
                rotate([0, sx * 78, 0])
                    mirror([0, 0, 1])
                        ball_socket_cut(PEG_BIG_D, 4.2, 4.0);
        }

        // Left & Right Hip Sockets (tucked cleanly under pelvis arches at x = +-10.5, z = 63.0)
        for (sx = [-1, 1]) {
            translate([sx * 10.5, 0, 63.0])
                rotate([0, sx * 12, 0])
                    ball_socket_cut(PEG_BIG_D, 4.6);
            // Smooth arch relief for thigh swing
            translate([sx * 10.5, 0, 58.2])
                sphere(r = 8.4, $fn = 64);
        }

        // Back Dock Mortise + Central Pro Bore (z=87.5) + 2 TU Tail Port Bore (z=62.5)
        back_and_tail_port_cuts();
    }
}

module part_back_dock_studs() {
    // 2x2 TU Snap Small Studs in #FF6B4A Coral Spark on a solid 1.4 mm mortise-tenon plate!
    // Seats into torso/snap_torso's y = 12.2..13.4 mortise so studs emerge at exact y = 13.6 mm!
    translate([0, 12.2, 87.5])
        rotate([-90, 0, 0]) {
            difference() {
                union() {
                    pill_box(24.0, 24.0, 1.4, 3.8);
                    for (ix = [-0.5, 0.5], iy = [-0.5, 0.5]) {
                        translate([ix * TU, iy * TU, 1.4])
                            tv_stud(root_sink = 0.5);
                    }
                }
                translate([0, 0, -0.2])
                    cylinder(h = 2.0, r = PRO_FREE_D / 2 + 0.1, $fn = 72);
            }
        }
}

// ============================================================================
// 3. ARMS & 6.6mm C-GRIP 3-FINGER HANDS (Built in local Z-up limb frame!)
// ============================================================================

module part_upper_arm() {
    // Length = 22.0 mm, exact z = 0..22.0
    H = 22.0;
    difference() {
        loft_ellipses([
            [0.0,  5.6, 5.6],
            [2.0,  7.2, 7.2],
            [11.0, 7.0, 7.0],
            [19.5, 6.8, 6.8],
            [H,    5.5, 5.5]
        ]);
        ball_socket_cut(PEG_SML_D, 4.0);
        translate([0, 0, H])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_BIG_D, 4.2);
    }
}

module part_forearm() {
    // Length = 21.0 mm, flared astronaut/vinyl wrist cuff, exact z = 0..21.0
    H = 21.0;
    difference() {
        loft_ellipses([
            [0.0,  8.4, 8.1],
            [1.6,  9.7, 9.3],
            [4.5,  9.5, 9.1],
            [13.0, 8.2, 8.0],
            [19.2, 7.3, 7.2],
            [H,    5.8, 5.8]
        ]);
        // Crisp ~38-deg double V-cuff groove near wrist (zero 90-deg overhang!)
        for (zg = [2.8, 4.6]) {
            v_groove_ring(zg, 9.8, 9.15, 0.96);
        }
        ball_socket_cut(PEG_SML_D, 4.0);
        translate([0, 0, H])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_SML_D, 4.0);
    }
}

module part_hand(side = 1) {
    // Sleek, reinforced 3-finger + opposing-thumb functional C-grip hand (Genus: 0, flat z = 0 print!)
    difference() {
        union() {
            // 1) Wrist-to-knuckle curved anatomical palm & seamless lower cradle bed
            hull() {
                cylinder(h = 1.0, r = 5.7, $fn = 64);
                translate([0, 0.4, 4.6]) scale([6.45, 5.35, 3.40]) sphere(r = 1.0, $fn = 56);
                for (ki = [-1, 0, 1]) {
                    k_mid = (ki == 0) ? 1.0 : 0.0;
                    translate([ki * 4.70, 2.65 + 0.35 * k_mid, 9.80 + 0.65 * k_mid])
                        scale([2.14, 3.10, 2.95]) sphere(r = 1.0, $fn = 48);
                }
                for (px = [-3.6, 0, 3.6])
                    translate([px, -1.95, 7.35]) scale([2.75, 2.65, 2.35]) sphere(r = 1.0, $fn = 44);
            }

            // 2) Three separated, reinforced concentric-arch fingers
            for (fi = [-1, 0, 1]) {
                fx0 = fi * 4.70;
                fx1 = fi * 4.82;
                fx2 = fi * 4.78;
                fx3 = fi * 4.68;
                mid_extra = (fi == 0) ? 0.80 : ((fi == -side) ? 0.25 : 0.0);

                hull() {
                    translate([fx0,  2.65 + (fi == 0 ? 0.35 : 0), 9.80 + (fi == 0 ? 0.65 : 0)])
                        scale([2.14, 3.10, 2.95]) sphere(r = 1.0, $fn = 48);
                    translate([fx1,  2.55, 12.40 + mid_extra * 0.25])
                        scale([2.04, 2.98, 2.65]) sphere(r = 1.0, $fn = 48);
                }
                hull() {
                    translate([fx1,  2.55, 12.40 + mid_extra * 0.25])
                        scale([2.04, 2.98, 2.65]) sphere(r = 1.0, $fn = 48);
                    translate([fx2,  1.05, 15.10 + mid_extra * 0.55])
                        scale([1.98, 2.80, 2.58]) sphere(r = 1.0, $fn = 48);
                }
                hull() {
                    translate([fx2,  1.05, 15.10 + mid_extra * 0.55])
                        scale([1.98, 2.80, 2.58]) sphere(r = 1.0, $fn = 48);
                    translate([fx3, -1.35, 16.75 + mid_extra * 0.85])
                        scale([1.92, 2.46, 2.62]) sphere(r = 1.0, $fn = 48);
                }
            }

            // 3) Reinforced opposing thumb (-side * X) with full-palm thenar buttress
            hull() {
                cylinder(h = 1.0, r = 5.7, $fn = 64);
                translate([0, 0.4, 4.6])             scale([6.45, 5.35, 3.40]) sphere(r = 1.0, $fn = 56);
                translate([-side * 4.2,  1.5, 8.6])                            sphere(r = 2.95, $fn = 44);
                translate([-side * 5.6, -4.3, 7.6])  scale([1.14, 1.08, 1.00]) sphere(r = 3.00, $fn = 48);
            }
            hull() {
                translate([-side * 3.4, -1.95, 7.55])                          sphere(r = 2.75, $fn = 44);
                translate([-side * 5.6, -4.30, 7.60]) scale([1.14, 1.08, 1.0]) sphere(r = 3.00, $fn = 48);
                translate([-side * 6.0, -6.40, 9.90]) scale([1.15, 1.08, 1.0]) sphere(r = 2.84, $fn = 48);
            }
            hull() {
                translate([-side * 6.0, -6.4,  9.9]) scale([1.15, 1.08, 1.0]) sphere(r = 2.84, $fn = 48);
                translate([-side * 5.5, -6.6, 12.0]) scale([1.14, 1.08, 1.0]) sphere(r = 2.64, $fn = 48);
            }
        }

        // Wrist ball-peg socket on flat z = 0 face (mates BOTH Pro spark_peg_sml AND Snap snap_turret!)
        intersection() {
            ball_socket_cut(PEG_SML_D, 3.6);
            translate([0, 0, -1]) cylinder(h = 8.75, r = 8.0, $fn = 64);
        }

        // Support-free Ø 6.75 mm 50-deg Teardrop Pro-shaft cradle (+Y_2d -> +Z_world toward fingertips!)
        translate([0, -2.3, 11.4])
            rotate([90, 0, 90])
                linear_extrude(height = 28, center = true)
                    teardrop_2d(PRO_SHAFT_D + 0.15);
    }
}

// ============================================================================
// 4. LEGS & 1x2 TU SOCKET SNEAKER BOOTS
// ============================================================================

module part_thigh() {
    H = 24.0;
    difference() {
        loft_ellipses([
            [0.0,  6.5, 6.6],
            [2.0,  8.0, 8.2],
            [12.0, 8.5, 8.8],
            [21.5, 8.3, 8.6],
            [H,    6.6, 6.8]
        ]);
        ball_socket_cut(PEG_SML_D, 4.2);
        translate([0, 0, H])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_BIG_D, 4.4);
    }
}

module part_shin() {
    // Flared art-toy boot-leg, exact z = 0..24.5
    H = 24.5;
    difference() {
        loft_ellipses([
            [0.0,  8.8, 9.4],
            [2.0, 10.2, 10.8],
            [6.0,  9.8, 10.3],
            [16.0, 8.5,  8.9],
            [22.5, 8.0,  8.3],
            [H,    6.5,  6.7]
        ]);
        // Crisp ~38-deg ankle V-cuff groove
        v_groove_ring(3.2, 10.3, 9.6, 1.06);
        ball_socket_cut(PEG_SML_D, 4.2);
        translate([0, 0, H])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_SML_D, 4.2);
    }
}

module part_boot() {
    // Chunky sneaker-boot (22.8 wide x 32.2 long x 13.0 tall, forward = -Y), clipped flush at z >= 0!
    // Underside houses 1x2 TU Snap Small sockets at y = -3.5 +- 6.25 PLUS scalloped outsole reliefs
    // for all neighbouring plate studs so Kip stands 100% flat anywhere on a 2x4 / 4x4 Snap plate!
    difference() {
        intersection() {
            translate([-30, -40, 0.0])
                cube([60, 80, 25.0]);
            union() {
                // Sole + Midsole with 0.5 mm bed chamfer
                hull() {
                    translate([0, -3.5, 0.0])  pill_box(21.6, 31.0, 0.05, 9.5);
                    translate([0, -3.5, 0.6])  pill_box(22.8, 32.2, 3.4,  10.0);
                }
                // Tapered midsole V-groove waist at z = 4.2 mm (38-deg slopes, zero overhang!)
                hull() {
                    translate([0, -3.5, 3.9])  pill_box(22.8, 32.2, 0.1, 10.0);
                    translate([0, -3.5, 4.35]) pill_box(21.5, 30.9, 0.1,  9.4);
                }
                // Puffy rounded sneaker upper + toe cap (z = 6.6 so sphere stays cleanly above sole!) + ankle collar
                hull() {
                    translate([0, -3.5, 4.35]) pill_box(21.5, 30.9, 0.1,  9.4);
                    translate([0, -3.5, 4.8])  pill_box(22.4, 31.6, 0.8,  9.8);
                    translate([0, -7.5, 6.6])  scale([1.0, 1.15, 0.64]) sphere(r = 9.8, $fn = 72);
                    translate([0,  1.5, 9.5])  scale([1.0, 1.05, 1.0])  cylinder(h = 3.5, r = 9.2, $fn = 72);
                }
            }
        }

        // Top Ankle Socket at y = +1.5, z = 13.0 (mates BOTH Pro spark_peg_sml AND Snap snap_turret!)
        translate([0, 1.5, 13.0])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_SML_D, 4.2);

        // 1x2 TU Snap Small Sockets in the flat sole (y = -9.75 and +2.75, pitch = 12.5 mm!)
        for (sy = [-0.5, 0.5]) {
            translate([0, -3.5 + sy * TU, 0])
                tv_socket_cut(3.5);
        }

        // Scalloped Outsole Tread Stud-Reliefs at all 10 surrounding lattice neighbours (I3_seats_on_reference!)
        for (sy = [-1.5, 1.5]) {
            translate([0, -3.5 + sy * TU, 0])
                tv_stud_relief_cut(3.2);
        }
        for (sx = [-1, 1], sy = [-1.5, -0.5, 0.5, 1.5]) {
            translate([sx * TU, -3.5 + sy * TU, 0])
                tv_stud_relief_cut(3.2);
        }
    }
}

// ============================================================================
// 5. #FF6B4A SPARK BALL-PEGS (Supportless flat-bed compliant joint connectors!)
// ============================================================================

module part_spark_peg(d = PEG_BIG_D) {
    // Truncated barrel peg with compliant cross-flex slots, prints flat on z=0!
    r = d / 2;
    h = d * 0.92;
    difference() {
        intersection() {
            translate([0, 0, h / 2])
                scale([1, 1, 1.06])
                    sphere(r = r, $fn = 72);
            cylinder(h = h, r = r + 1, $fn = 72);
        }
        // Compliant flex slots at top & bottom so PLA/PETG snaps smoothly without fusing
        translate([-r - 1, -0.55, h * 0.32])
            cube([2 * r + 2, 1.1, h]);
        translate([-0.55, -r - 1, -0.1])
            cube([1.1, 2 * r + 2, h * 0.68]);
        // Center axial 2.0 mm relief hole
        translate([0, 0, -0.1])
            cylinder(h = h + 0.2, r = 1.0, $fn = 36);
    }
}

// ============================================================================
// 6. TEST ACCESSORIES FOR EAR-POD BOSSES & LOWER-BACK TAIL PORT (12.5 mm TU!)
// ============================================================================

module part_ear_acc(side = 1) {
    // Snap Small (Ø 6.7 mm female socket at z = 0) Comm-Headphone Cup + Support-Free Flat-Base Aerial!
    difference() {
        intersection() {
            translate([-30, -15, 0.0])
                cube([60, 30, 12.0]);
            union() {
                cylinder(h = 3.2, r1 = 9.0, r2 = 9.4, $fn = 72);
                translate([0, 0, 3.2])
                    cylinder(h = 3.4, r1 = 9.4, r2 = 7.2, $fn = 72);
                translate([0, 0, 6.6])
                    cylinder(h = 1.2, r1 = 5.4, r2 = 4.2, $fn = 64);

                // Swept comm aerial seated flush on z = 0 (zero mid-air cantilever!)
                hull() {
                    translate([-side * 5.5, 1.0, 1.6]) sphere(r = 2.6, $fn = 36);
                    translate([-side * 19.5, 4.5, 1.4]) sphere(r = 2.0, $fn = 36);
                }
                translate([-side * 21.0, 5.0, 1.6])
                    sphere(r = 2.8, $fn = 44);
            }
        }

        tv_socket_cut(3.4);

        difference() {
            translate([0, 0, 6.5]) cylinder(h = 0.8, r = 6.8, $fn = 64);
            translate([0, 0, 6.4]) cylinder(h = 1.0, r = 5.8, $fn = 64);
        }
    }
}

// Clean tail geometry: origin (0,0,0) is the flat collar seat face!
// +Z (0..10.4) is a compliant slotted Ø 7.08 mm friction-pin plug clicking INTO Kip's z = 62.5 rear port,
// -Z (0..-33.7) sweeps BACKWARD (-Z_three) and UPWARD (+Y_three) with flat x = +-3.45 mm side cheeks for 100% flat-bed printing!
module part_tail_test() {
    difference() {
        intersection() {
            translate([-3.45, -15.0, -40.0])
                cube([6.90, 50.0, 55.0]);
            union() {
                // Compliant Pro Ø 6.8 mm body + Ø 7.08 mm friction-retention bead plugging into Kip's z = 62.5 port
                cylinder(h = 9.2, r = 3.40, $fn = 64);
                translate([0, 0, 2.2])
                    cylinder(h = 1.4, r1 = 3.40, r2 = 3.54, $fn = 64);
                translate([0, 0, 3.6])
                    cylinder(h = 2.4, r = 3.54, $fn = 64);
                translate([0, 0, 6.0])
                    cylinder(h = 1.4, r1 = 3.54, r2 = 3.40, $fn = 64);
                translate([0, 0, 9.2])
                    cylinder(h = 1.2, r1 = 3.40, r2 = 2.85, $fn = 64);

                // Flat-faced collar ring at z = 0.0 (seats flush against Kip's rear tail boss!)
                hull() {
                    translate([0, 0, -0.8]) cylinder(h = 0.8, r1 = 5.2, r2 = 5.2, $fn = 56);
                    translate([0, -0.6, -5.5]) sphere(r = 4.5, $fn = 48);
                }
                hull() {
                    translate([0, -0.6, -5.5])  sphere(r = 4.5, $fn = 48);
                    translate([0,  4.8, -16.0]) sphere(r = 3.8, $fn = 48);
                }
                hull() {
                    translate([0,  4.8, -16.0]) sphere(r = 3.8, $fn = 48);
                    translate([0, 15.0, -24.5]) sphere(r = 3.4, $fn = 48);
                }
                hull() {
                    translate([0, 15.0, -24.5]) sphere(r = 3.4, $fn = 48);
                    translate([0, 22.0, -28.5]) sphere(r = 5.2, $fn = 56);
                }
            }
        }
        // Compliant flex slot through the +Z friction plug so it clicks smoothly in & out
        translate([-0.55, -5.0, 2.0])
            cube([1.1, 10.0, 9.0]);
    }
}

// ============================================================================
// 7. SIMPLIFIED SNAP (3+) EDITION BODY PARTS
//    Reuses 100% identical Head assembly, 3-Finger Hands, 1x2 Sneaker Boots,
//    2x2 Back Dock, and all 5 TU Accessory Zones — with chunky 1-piece arms,
//    1-piece legs, and reversible flanged compliant Snap turrets!
// ============================================================================

module part_snap_torso() {
    difference() {
        union() {
            // Chunkier, cuddlier 1-piece coverall capsule torso
            loft_ellipses([
                [ 57.5,  8.5,  7.2],
                [ 59.8, 14.5, 11.2],
                [ 65.0, 16.8, 12.6],
                [ 76.0, 16.9, 12.7],
                [ 91.0, 17.6, 13.0],
                [ 99.5, 16.0, 11.8],
                [103.5, 11.5,  9.6],
                [105.5,  8.6,  8.0]
            ]);

            // Same 2x2 TU Back Dock Boss at z = 87.5
            hull() {
                translate([0, 9.0, 86.2])
                    rotate([-90, 0, 0])
                        pill_box(28.4, 29.8, 0.2, 5.4);
                translate([0, 12.8, 87.5])
                    rotate([-90, 0, 0])
                        pill_box(26.8, 26.8, 0.6, 4.4);
            }

            // Same Lower-Back Tail Boss at exact z = 62.5 (2.0 TU below Back Dock, >= z = 57.6 mm!)
            hull() {
                translate([0, 9.5, 62.5])
                    rotate([-90, 0, 0])
                        cylinder(h = 0.2, r = 4.9, $fn = 56);
                translate([0, 12.6, 62.5])
                    rotate([-90, 0, 0])
                        cylinder(h = 0.5, r = 4.9, $fn = 56);
            }
        }

        // Top Neck Turret Socket + Shoulder Sockets + Hip Sockets (mate reversible snap_turret_big!)
        translate([0, 0, 105.5])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_BIG_D, 4.4);

        for (sx = [-1, 1]) {
            translate([sx * 15.2, 0, 95.0])
                rotate([0, sx * 84, 0])
                    mirror([0, 0, 1])
                        ball_socket_cut(PEG_BIG_D, 4.2, 4.0);

            translate([sx * 10.8, 0, 62.5])
                ball_socket_cut(PEG_BIG_D, 4.4);
            translate([sx * 10.8, 0, 57.6])
                sphere(r = 8.6, $fn = 64);
        }

        // Back Dock Mortise + Central Pro Bore (z=87.5) + 2 TU Tail Port Bore (z=62.5)
        back_and_tail_port_cuts();
    }
}

module part_snap_arm() {
    // 1-piece chunky curved Snap (3+) sleeve (exact H = 34.0 mm, single watertight body!):
    // z = 0 cuff mates reversible snap_turret (8.0 mm -> shared hand_l/r!),
    // z = 34.0 shoulder mates reversible snap_turret_big (9.0 mm -> snap_torso!).
    difference() {
        intersection() {
            translate([-20, -20, 0.0])
                cube([40, 40, 34.0]);
            union() {
                hull() {
                    translate([0, -3.8, 0.0])  cylinder(h = 0.8, r = 8.8, $fn = 72);
                    translate([0, -3.5, 2.2])  cylinder(h = 1.6, r = 9.8, $fn = 72);
                    translate([0, -2.0, 14.5]) sphere(r = 8.4, $fn = 64);
                }
                hull() {
                    translate([0, -2.0, 14.5]) sphere(r = 8.4, $fn = 64);
                    translate([0,  0.0, 26.2]) sphere(r = 7.5, $fn = 64);
                    translate([0,  0.0, 33.2]) cylinder(h = 0.8, r = 6.2, $fn = 64);
                }
            }
        }
        // ~38-deg V-cuff groove (zero 90-deg overhang!)
        translate([0, -3.6, 3.6])
            rotate([11, 0, 0])
                v_groove_ring(0, 9.9, 9.1, 1.0);

        // Wrist turret socket at z = 0 cuff + Open Shoulder socket at z = 34.0!
        translate([0, -3.8, 0.0])
            ball_socket_cut(PEG_SML_D, 3.8);
        translate([0, 0, 34.0])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_BIG_D, 4.2);
    }
}

module part_snap_leg() {
    // 1-piece chunky flared Snap (3+) trouser-leg (exact H = 38.0 mm):
    // z = 0 ankle mates reversible snap_turret (8.0 mm -> shared boot!),
    // z = 38.0 hip mates reversible snap_turret_big (9.0 mm -> snap_torso!).
    H = 38.0;
    difference() {
        loft_ellipses([
            [0.0,   9.0,  9.5],
            [2.4,  10.4, 11.0],
            [8.0,  10.0, 10.5],
            [22.0,  9.2,  9.6],
            [34.5,  8.6,  8.9],
            [H,     6.8,  7.0]
        ]);
        // Crisp ~38-deg trouser V-cuff groove
        v_groove_ring(3.6, 10.5, 9.7, 1.06);
        ball_socket_cut(PEG_SML_D, 4.0);
        translate([0, 0, H])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_BIG_D, 4.2);
    }
}

// Reversible, compliant Coral Spark (#FF6B4A) Snap Swivel Turret Collar!
// - Support-free upright on z = 0 (truncated ends + 45-deg double-chamfered anti-pinch center collar!)
// - Physically snaps into shared head_shell (d = 9.0), hand_l/r (d = 8.0), and boot (d = 8.0)!
module part_snap_turret(d = PEG_SML_D) {
    r  = d / 2;
    h  = d * 1.15;          // 9.2 mm (sml) / 10.35 mm (big)
    zb = d * 0.25;          // lower ball equator z (truncated at z=0 with <=41.4 deg overhang!)
    zt = h - zb;            // upper ball equator z
    rf = r + 1.15;          // wide center stop-flange radius
    zm = h / 2;
    difference() {
        intersection() {
            cylinder(h = h, r = rf + 1.0, $fn = 84);
            union() {
                // Lower & upper compliant snap-balls
                translate([0, 0, zb]) sphere(r = r, $fn = 72);
                translate([0, 0, zt]) sphere(r = r, $fn = 72);
                // Connecting neck shaft
                translate([0, 0, zb]) cylinder(h = zt - zb, r = r * 0.84, $fn = 72);
                // Support-free 45-deg double-chamfered center collar flange (zero mid-air ledge!)
                hull() {
                    translate([0, 0, zm - (rf - r * 0.84) - 0.35])
                        cylinder(h = 0.05, r = r * 0.84, $fn = 72);
                    translate([0, 0, zm - 0.35])
                        cylinder(h = 0.70, r = rf, $fn = 72);
                    translate([0, 0, zm + (rf - r * 0.84) + 0.30])
                        cylinder(h = 0.05, r = r * 0.84, $fn = 72);
                }
            }
        }
        // Compliant cross-flex slots at top & bottom ends
        translate([-rf - 1, -0.52, h * 0.62])
            cube([2 * rf + 2, 1.04, h]);
        translate([-0.52, -rf - 1, -0.1])
            cube([1.04, 2 * rf + 2, h * 0.38 + 0.1]);
        // Center axial 2.0 mm relief bore
        translate([0, 0, -0.1])
            cylinder(h = h + 0.2, r = 1.0, $fn = 36);
    }
}

// Universal Ø 9.0 mm Ball-to-2x1-Stud Spark Neck Turret (lets BOTH Pro 8+ & Snap 3+ Kip wear ANY PartSpec 2x1 Head!)
module part_neck_turret_2x1() {
    r  = PEG_BIG_D / 2;   // 4.5 mm
    zb = 2.25;            // ball equator z (truncated flat at z = 0, <= 41.4 deg overhang)
    zp = 8.00;            // low-profile 2x1 collar start (<= 44.7 deg support-free flare!)
    zt = 8.60;            // 2x1 stud seat plane (seats low on Kip's neck collar at y = 107.8 mm!)
    difference() {
        union() {
            // Lower compliant Ø 9.0 mm snap-ball
            intersection() {
                translate([0, 0, zb]) sphere(r = r, $fn = 72);
                cylinder(h = zb + r + 1, r = r + 1, $fn = 72);
            }
            // Support-free <= 44.7 deg flare from neck ball into compact 2x1 TU collar pad
            hull() {
                translate([0, 0, zb])
                    cylinder(h = 0.2, r = r - 0.05, $fn = 72);
                translate([0, 0, zp])
                    pill_box(20.4, 10.4, zt - zp, 4.6);
            }
            // Centered 2x1 ToyVentor Small Studs (x = +-6.25 mm, y = 0, z = 8.60 mm)
            for (sx = [-0.5, 0.5]) {
                translate([sx * TU, 0, zt])
                    tv_stud(0.2);
            }
        }
        // Compliant lower flex slot + center 2.0 mm relief hole for smooth snap into torso neck socket
        translate([-0.52, -r - 1, -0.1])
            cube([1.04, 2 * r + 2, 4.1]);
        translate([0, 0, -0.1])
            cylinder(h = 5.8, r = 1.0, $fn = 36);
    }
}

// ============================================================================
// Export Dispatcher (Assembly Frame by default; Flat-on-Bed when PRINT_ORIENT=true)
// ============================================================================

module build_part(p) {
    if      (p == "head_shell")      part_head_shell();
    else if (p == "head_hood")       part_head_hood();
    else if (p == "crown_buds")      part_crown_buds();
    else if (p == "crown_cap_blank") part_crown_cap_blank();
    else if (p == "ear_pod_l")       part_ear_pod( 1);
    else if (p == "ear_pod_r")       part_ear_pod(-1);
    else if (p == "visor")           part_visor();
    else if (p == "face_eyes")       part_face_eyes();
    else if (p == "face_glints")     part_face_glints();
    else if (p == "face_cheeks")     part_face_cheeks();
    else if (p == "torso")           part_torso();
    else if (p == "back_dock_studs") part_back_dock_studs();
    else if (p == "upper_arm")       part_upper_arm();
    else if (p == "forearm")         part_forearm();
    else if (p == "hand_l")          part_hand( 1);
    else if (p == "hand_r")          part_hand(-1);
    else if (p == "thigh")           part_thigh();
    else if (p == "shin")            part_shin();
    else if (p == "boot")            part_boot();
    else if (p == "spark_peg_big")   part_spark_peg(PEG_BIG_D);
    else if (p == "spark_peg_sml")   part_spark_peg(PEG_SML_D);
    else if (p == "ear_acc_l")       part_ear_acc( 1);
    else if (p == "ear_acc_r")       part_ear_acc(-1);
    else if (p == "tail_acc")        part_tail_test();
    else if (p == "snap_torso")      part_snap_torso();
    else if (p == "snap_arm")        part_snap_arm();
    else if (p == "snap_leg")        part_snap_leg();
    else if (p == "snap_turret")     part_snap_turret(PEG_SML_D);
    else if (p == "snap_turret_big") part_snap_turret(PEG_BIG_D);
    else if (p == "neck_turret_2x1") part_neck_turret_2x1();
}

module export_print_oriented(p) {
    if      (p == "head_hood")       translate([0, 0, -9.5]) build_part(p);
    else if (p == "crown_buds")      translate([0, 0, -40.4]) build_part(p);
    else if (p == "crown_cap_blank") translate([0, 0, -40.4]) build_part(p);
    else if (p == "ear_pod_l")       rotate([0, -90, 0]) translate([-(HEAD_W / 2 - 1.2), 0, -20.0]) build_part(p);
    else if (p == "ear_pod_r")       rotate([0,  90, 0]) translate([ (HEAD_W / 2 - 1.2), 0, -20.0]) build_part(p);
    else if (p == "visor")           translate([0, 0, -10.1]) build_part(p);
    else if (p == "face_eyes")       rotate([-90, 0, 0]) translate([0, 16.03, -17.0]) build_part(p);
    else if (p == "face_glints")     rotate([-90, 0, 0]) translate([0, 16.68, -17.0]) build_part(p);
    else if (p == "face_cheeks")     rotate([-90, 0, 0]) translate([0, 14.27, -14.3]) build_part(p);
    else if (p == "torso")           translate([0, 0, -57.5]) build_part(p);
    else if (p == "snap_torso")      translate([0, 0, -57.5]) build_part(p);
    else if (p == "back_dock_studs") rotate([90, 0, 0]) translate([0, -12.2, -87.5]) build_part(p);
    else if (p == "tail_acc")        translate([0, 0, 3.45]) rotate([0, 90, 0]) build_part(p);
    else                             build_part(p);
}

if (PRINT_ORIENT) export_print_oriented(PART);
else              build_part(PART);
