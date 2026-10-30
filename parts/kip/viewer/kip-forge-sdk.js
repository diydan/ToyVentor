// ToyVentor Kip Expansion Helpers:
//   1) 2D Decal Expression Skins (`BRAND_STYLE.md` rule 5: zero moulded 3D faces)
//   2) Phase 4 Photo-to-Accessory Forge (`prints: false` digital-only game accessories)
//   3) `#toy=` ToyContract URL encoder & LLM PartSpec Prompt loader

export const DECAL_EXPRESSIONS = [
  { id: 'spark',     label: 'Spark' },
  { id: 'happy',     label: 'Happy' },
  { id: 'wink',      label: 'Wink' },
  { id: 'cool',      label: 'Cool Shades' },
  { id: 'starry',    label: 'Starry' },
  { id: 'surprised', label: 'Surprised' },
  { id: 'blank',     label: 'Blank Plate' },
];

export function createDecalExpressionCanvas(expression = 'spark', headType = 'kid') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (expression === 'blank') return c;

  const isRobot = headType === 'robot';
  const isAnimal = headType === 'fox' || headType === 'bear';
  const isHuman = !isRobot && !isAnimal;

  // Dark LED visor screen ONLY for Robot head; Human & Critter heads use visor-free transparent decal skin!
  if (isRobot) {
    ctx.fillStyle = '#161d30';
    roundRect(ctx, 36, 36, 440, 184, 82);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(184, 232, 255, 0.38)';
    ctx.stroke();
  }

  // Soft cream muzzle mask + button nose + critter mouth for Fox & Bear
  if (isAnimal) {
    ctx.fillStyle = 'rgba(252, 246, 236, 0.94)';
    ctx.beginPath();
    ctx.ellipse(256, 178, headType === 'bear' ? 92 : 82, 56, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const eyeCol = isRobot ? '#b8e8ff' : '#241814';
  const mouthCol = isRobot ? '#b8e8ff' : '#3B221B';
  const glintCol = '#ffffff';
  const cheekCol = '#ff6b4a';

  // Signature Coral Spark cheek blushes (wider out on the cheeks for Human faces!)
  ctx.fillStyle = cheekCol;
  if (isHuman) {
    for (const bx of [72, 440]) {
      const rg = ctx.createRadialGradient(bx, 152, 4, bx, 152, 34);
      rg.addColorStop(0, 'rgba(255, 107, 74, 0.58)');
      rg.addColorStop(0.65, 'rgba(255, 118, 92, 0.26)');
      rg.addColorStop(1, 'rgba(255, 118, 92, 0.0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.ellipse(bx, 152, 34, 19, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.globalAlpha = isAnimal ? 0.74 : 0.90;
    drawCapsule(ctx, 84, 176, 52, 24);
    drawCapsule(ctx, 428, 176, 52, 24);
    ctx.globalAlpha = 1.0;
  }

  // Expressive human eyebrows framed inside the Asaro orbital hollows (nose is sculpted in 3D on `char_faceplate`!)
  if (isHuman) {
    ctx.strokeStyle = 'rgba(58, 34, 22, 0.88)';
    ctx.lineWidth = 9.5;
    ctx.lineCap = 'round';
    for (const [bx, dir] of [[132, -1], [380, 1]]) {
      ctx.beginPath();
      const lift = expression === 'surprised'
        ? -12
        : (expression === 'cool' ? -8 : (expression === 'wink' && dir === 1 ? 8 : 0));
      ctx.arc(bx, 62 + lift, 38, Math.PI * 1.20, Math.PI * 1.80);
      ctx.stroke();
    }
  }

  // Cute stylized button nose tip for Fox / Bear (2D decal only — zero 3D nostril holes!)
  if (isAnimal) {
    ctx.fillStyle = '#20232A';
    ctx.beginPath();
    ctx.ellipse(256, 154, headType === 'bear' ? 26 : 21, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(249, 149, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const eyeCenters = isHuman ? [132, 380] : [152, 360];

  const drawHumanOrCritterEye = (cx, cy = 104, side = 0) => {
    if (isHuman) {
      // Crisp expressive human eye oval + warm iris + curved upper eyelash line
      ctx.fillStyle = eyeCol;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 32, 35, 0, 0, Math.PI * 2);
      ctx.fill();

      // Warm chestnut-amber iris crescent
      ctx.fillStyle = '#8B5437';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 14, 21, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#BA7D56';
      ctx.beginPath();
      ctx.ellipse(cx + 3, cy + 17, 13, 6.2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Re-deepen pupil center
      ctx.fillStyle = eyeCol;
      ctx.beginPath();
      ctx.arc(cx, cy - 2, 16.5, 0, Math.PI * 2);
      ctx.fill();

      // Soft upper eyelash sweep
      ctx.strokeStyle = eyeCol;
      ctx.lineWidth = 7.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy + 2, 34, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      if (side !== 0) {
        ctx.beginPath();
        ctx.moveTo(cx + side * 29, cy - 10);
        ctx.lineTo(cx + side * 38, cy - 17);
        ctx.stroke();
      }

      // Twin lively catchlights
      ctx.fillStyle = glintCol;
      ctx.beginPath();
      ctx.arc(cx - 10, cy - 12, 11.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 11, cy + 11, 5.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.fillStyle = eyeCol;
    roundRect(ctx, cx - 33, cy - 39, 66, 78, 31);
    ctx.fill();
    ctx.fillStyle = glintCol;
    ctx.beginPath();
    ctx.arc(cx - 11, cy - 15, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 12, cy + 14, 6, 0, Math.PI * 2);
    ctx.fill();
  };

  if (expression === 'spark') {
    const eY = isHuman ? 104 : 124;
    drawHumanOrCritterEye(eyeCenters[0], eY, -1);
    drawHumanOrCritterEye(eyeCenters[1], eY, 1);
    if (isHuman) {
      ctx.strokeStyle = mouthCol;
      ctx.lineWidth = 9.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(256, 198, 28, 0.16 * Math.PI, 0.84 * Math.PI);
      ctx.stroke();
    } else if (isAnimal) {
      ctx.strokeStyle = mouthCol;
      ctx.lineWidth = 8.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(237, 174, 19, 0.08 * Math.PI, 0.92 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(275, 174, 19, 0.08 * Math.PI, 0.92 * Math.PI);
      ctx.stroke();
    }
  } else if (expression === 'happy') {
    ctx.strokeStyle = eyeCol;
    ctx.lineWidth = isHuman ? 13 : 15;
    ctx.lineCap = 'round';
    for (const cx of eyeCenters) {
      ctx.beginPath();
      ctx.arc(cx, isHuman ? 116 : 138, isHuman ? 32 : 37, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
    if (isHuman) {
      // Cheerful open D-laugh positioned cleanly below the 3D nose tip!
      ctx.save();
      ctx.beginPath();
      ctx.arc(256, 198, 30, 0, Math.PI, false);
      ctx.closePath();
      ctx.fillStyle = mouthCol;
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(222, 196, 68, 9);
      ctx.fillStyle = '#FF7E6B';
      ctx.beginPath();
      ctx.ellipse(256, 222, 18, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.strokeStyle = mouthCol;
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.arc(256, 168, 30, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.stroke();
    }
  } else if (expression === 'wink') {
    drawHumanOrCritterEye(eyeCenters[0], isHuman ? 104 : 124, -1);

    ctx.strokeStyle = eyeCol;
    ctx.lineWidth = isHuman ? 12.5 : 14;
    ctx.lineCap = 'round';
    const wx = eyeCenters[1];
    ctx.beginPath();
    ctx.arc(wx, isHuman ? 114 : 136, isHuman ? 30 : 35, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
    if (isHuman) {
      ctx.lineWidth = 7.5;
      ctx.beginPath();
      ctx.moveTo(wx + 27, 104);
      ctx.lineTo(wx + 37, 96);
      ctx.stroke();
    }

    ctx.strokeStyle = mouthCol;
    ctx.lineWidth = 9.5;
    ctx.beginPath();
    ctx.arc(262, isHuman ? 198 : 169, isHuman ? 27 : 32, 0.14 * Math.PI, 0.82 * Math.PI);
    ctx.stroke();
  } else if (expression === 'cool') {
    if (isHuman) {
      // Playful rounded human sunglasses resting across the 3D nose bridge!
      for (const lx of [132, 380]) {
        const lg = ctx.createLinearGradient(lx, 68, lx, 142);
        lg.addColorStop(0, 'rgba(34, 39, 54, 0.94)');
        lg.addColorStop(1, 'rgba(72, 48, 62, 0.86)');
        ctx.fillStyle = lg;
        ctx.strokeStyle = '#241B18';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.ellipse(lx, 104, 66, 36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,255,255,0.68)';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(lx - 28, 122);
        ctx.lineTo(lx - 4, 84);
        ctx.stroke();
      }
      ctx.strokeStyle = '#241B18';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(256, 102, 26, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#20232A';
      ctx.strokeStyle = '#FFB830';
      ctx.lineWidth = 9;
      roundRect(ctx, 74, 78, 162, 80, 22);
      ctx.fill();
      ctx.stroke();
      roundRect(ctx, 276, 78, 162, 80, 22);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(236, 102);
      ctx.lineTo(276, 102);
      ctx.stroke();
    }
    // Confident smirk
    ctx.strokeStyle = isRobot ? '#FFB830' : mouthCol;
    ctx.lineWidth = 9.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(264, isHuman ? 198 : 174, isHuman ? 26 : 30, 0.16 * Math.PI, 0.76 * Math.PI);
    ctx.stroke();
  } else if (expression === 'starry') {
    if (isHuman) {
      for (const cx of eyeCenters) {
        ctx.fillStyle = eyeCol;
        ctx.beginPath();
        ctx.ellipse(cx, 104, 32, 36, 0, 0, Math.PI * 2);
        ctx.fill();
        drawStar(ctx, cx, 104, 5, 22, 10, '#FFB830');
        drawStar(ctx, cx - 11, 86, 4, 8.5, 3.2, '#ffffff');
      }
    } else {
      for (const cx of eyeCenters) {
        drawStar(ctx, cx, 120, 5, 40, 18, '#FFB830');
        drawStar(ctx, cx, 120, 4, 16, 6, '#ffffff');
      }
    }
    ctx.fillStyle = mouthCol;
    ctx.beginPath();
    ctx.ellipse(256, isHuman ? 210 : 180, isHuman ? 15 : 18, isHuman ? 11 : 13, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (expression === 'surprised') {
    const eY = isHuman ? 104 : 122;
    for (const cx of eyeCenters) {
      ctx.fillStyle = eyeCol;
      ctx.beginPath();
      ctx.arc(cx, eY, isHuman ? 31 : 37, 0, Math.PI * 2);
      ctx.fill();
      if (isHuman) {
        ctx.fillStyle = '#8B5437';
        ctx.beginPath();
        ctx.ellipse(cx, eY + 13, 18, 10, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = glintCol;
      ctx.beginPath();
      ctx.arc(cx - 10, eY - 11, 10.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 10, eY + 10, 4.8, 0, Math.PI * 2);
      ctx.fill();
    }
    const mY = isHuman ? 212 : 181;
    ctx.fillStyle = mouthCol;
    ctx.beginPath();
    ctx.ellipse(256, mY, isHuman ? 15 : 18, isHuman ? 18 : 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FF7E6B';
    ctx.beginPath();
    ctx.ellipse(256, mY + 9, 9.5, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCapsule(ctx, cx, cy, w, h) {
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();
}

function drawStar(ctx, cx, cy, pts, rOut, rIn, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / pts;
    const r = i % 2 === 0 ? rOut : rIn;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

// ===========================================================================
// FRONT-ONLY CHEST STENCIL STICKERS FOR SHIRTS, JACKETS & OVERALLS
// (`BRAND_STYLE.md`: solid single-filament 3D parts + crisp front-only chest stencil sticker!)
// Mapped cleanly onto the flat front chest of `torso` (`width = 18.8 mm, height = 21.5 mm`).
// ===========================================================================
export function createTorsoOutfitDecalCanvas(shirtId = 'off', _pantsId = 'off', skinHex = '#F3BA95') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);
  if (!shirtId || shirtId === 'off') return c;

  const botY = 486;

  if (shirtId === 'spark_tee') {
    // Classic crew-neck collar + crisp front Spark Bolt die-cut sticker badge!
    ctx.fillStyle = skinHex;
    ctx.beginPath();
    ctx.ellipse(256, 10, 96, 56, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.ellipse(256, 10, 104, 62, 0, 0.08 * Math.PI, 0.92 * Math.PI);
    ctx.stroke();

    // Die-cut white sticker circle + golden ring + Coral Spark lightning bolt
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(256, 256, 104, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFB830';
    ctx.lineWidth = 14;
    ctx.stroke();

    ctx.fillStyle = '#FF6B4A';
    ctx.beginPath();
    ctx.moveTo(276, 172);
    ctx.lineTo(204, 264);
    ctx.lineTo(252, 264);
    ctx.lineTo(230, 342);
    ctx.lineTo(310, 246);
    ctx.lineTo(260, 246);
    ctx.closePath();
    ctx.fill();
  } else if (shirtId === 'hoodie') {
    // Front hoodie stencil: center zipper + drawstrings + kangaroo pocket + chest star patch
    ctx.strokeStyle = 'rgba(18, 28, 52, 0.58)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(256, 30);
    ctx.lineTo(256, botY);
    ctx.stroke();
    ctx.strokeStyle = '#DCE4F2';
    ctx.lineWidth = 5;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.moveTo(256, 36);
    ctx.lineTo(256, botY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Kangaroo front pouch
    ctx.fillStyle = 'rgba(16, 36, 84, 0.30)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 7;
    roundRect(ctx, 92, 304, 328, 148, 38);
    ctx.fill();
    ctx.stroke();

    // Hoodie drawstrings + aglets
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    for (const [sx, ex] of [[198, 186], [314, 326]]) {
      ctx.beginPath();
      ctx.moveTo(sx, 36);
      ctx.quadraticCurveTo(sx, 128, ex, 196);
      ctx.stroke();
      ctx.fillStyle = '#FF6B4A';
      roundRect(ctx, ex - 9, 190, 18, 26, 7);
      ctx.fill();
    }

    // Mini Spark patch on left chest
    ctx.fillStyle = '#FF6B4A';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 6;
    roundRect(ctx, 314, 126, 92, 64, 16);
    ctx.fill();
    ctx.stroke();
    drawStar(ctx, 360, 158, 5, 20, 9, '#FFB830');
  } else if (shirtId === 'varsity') {
    // Front varsity stencil: cream snap-button placket + bold "K" chenille patch + angled welt pockets
    ctx.fillStyle = '#F4EFE6';
    roundRect(ctx, 232, 22, 48, botY - 30, 16);
    ctx.fill();
    for (const by of [92, 188, 284, 380, 452]) {
      ctx.fillStyle = '#20232A';
      ctx.beginPath();
      ctx.arc(256, by, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(252, by - 3, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Angled side welt pockets
    ctx.strokeStyle = '#F4EFE6';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(106, 308); ctx.lineTo(146, 404); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(406, 308); ctx.lineTo(366, 404); ctx.stroke();

    // Bold "K" Varsity Letter Patch
    ctx.fillStyle = '#FF6B4A';
    ctx.strokeStyle = '#F4EFE6';
    ctx.lineWidth = 11;
    roundRect(ctx, 302, 114, 114, 128, 24);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 84px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('K', 359, 182);
  } else if (shirtId === 'overalls') {
    // Front denim overall bib stencil over solid sunny-yellow shirt torso!
    ctx.fillStyle = '#2F5596';
    roundRect(ctx, 96, 8, 68, 190, 16);
    ctx.fill();
    roundRect(ctx, 348, 8, 68, 190, 16);
    ctx.fill();
    roundRect(ctx, 84, 158, 344, botY - 158, 28);
    ctx.fill();

    // Amber top-stitching + center bib pocket
    ctx.strokeStyle = '#F2B83B';
    ctx.lineWidth = 6;
    ctx.setLineDash([11, 8]);
    roundRect(ctx, 98, 172, 316, botY - 186, 20);
    ctx.stroke();
    roundRect(ctx, 174, 246, 164, 146, 22);
    ctx.stroke();
    ctx.setLineDash([]);

    // Brass overall buttons
    for (const bx of [130, 382]) {
      ctx.fillStyle = '#FFB830';
      ctx.strokeStyle = '#8C5319';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(bx, 194, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#FF6B4A';
    roundRect(ctx, 326, 270, 24, 38, 6);
    ctx.fill();
  } else if (shirtId === 'stripe_tee') {
    // Front Breton stripe chest sticker panel + coral star pocket!
    ctx.fillStyle = '#F4EFE6';
    for (let sy = 84; sy < botY - 24; sy += 66) {
      roundRect(ctx, 44, sy, 424, 30, 14);
      ctx.fill();
    }
    ctx.fillStyle = skinHex;
    ctx.beginPath();
    ctx.ellipse(256, 10, 96, 54, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FF6B4A';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.ellipse(256, 10, 102, 60, 0, 0.08 * Math.PI, 0.92 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = '#FF6B4A';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 7;
    roundRect(ctx, 304, 168, 98, 108, 20);
    ctx.fill();
    ctx.stroke();
    drawStar(ctx, 353, 222, 5, 24, 11, '#FFFFFF');
  } else if (shirtId === 'track_top') {
    // Front racing stripe + center zip + checkered badge stencil!
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, 128, 18, 30, botY - 26, 12);
    ctx.fill();
    ctx.fillStyle = '#FF6B4A';
    roundRect(ctx, 168, 18, 30, botY - 26, 12);
    ctx.fill();

    ctx.strokeStyle = '#20232A';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(256, 20);
    ctx.lineTo(256, botY - 12);
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, 298, 144, 110, 82, 16);
    ctx.fill();
    ctx.fillStyle = '#20232A';
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 4; col++) {
        if ((r + col) % 2 === 0) ctx.fillRect(308 + col * 22.5, 154 + r * 21, 22.5, 21);
      }
    }
  }

  return c;
}

export function createLegOutfitDecalCanvas(pantsId = 'off') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);

  if (pantsId === 'jeans') {
    ctx.strokeStyle = '#F2B83B';
    ctx.lineWidth = 6;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.arc(128, 22, 84, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (pantsId === 'overalls_jeans') {
    // Reinforced workwear knee/thigh patch with amber stitching!
    ctx.fillStyle = 'rgba(24, 48, 96, 0.48)';
    roundRect(ctx, 48, 76, 160, 118, 26);
    ctx.fill();
    ctx.strokeStyle = '#F2B83B';
    ctx.lineWidth = 6;
    ctx.setLineDash([9, 6]);
    roundRect(ctx, 48, 76, 160, 118, 26);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (pantsId === 'cargo_shorts') {
    // Stitched cargo pocket + flap + button!
    ctx.fillStyle = 'rgba(92, 74, 52, 0.26)';
    roundRect(ctx, 44, 62, 168, 134, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(72, 56, 38, 0.65)';
    ctx.lineWidth = 5;
    roundRect(ctx, 44, 62, 168, 134, 22);
    ctx.stroke();
    ctx.fillStyle = 'rgba(92, 74, 52, 0.42)';
    roundRect(ctx, 40, 56, 176, 46, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4A3F32';
    ctx.beginPath();
    ctx.arc(128, 82, 9, 0, Math.PI * 2);
    ctx.fill();
  } else if (pantsId === 'sport_shorts') {
    // Crisp white retro athletic hem stripe!
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, 18, 186, 220, 24, 10);
    ctx.fill();
  } else if (pantsId === 'joggers') {
    // Twin vertical athletic stripes!
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(46, 8, 18, 240);
    ctx.fillStyle = '#FF6B4A';
    ctx.fillRect(72, 8, 14, 240);
  }
  return c;
}

// ===========================================================================
// PHASE 4: PHOTO-TO-ACCESSORY FORGE (`prints: false` Digital Game Accessories)
// ===========================================================================
export const KID_DRAWING_PRESETS = {
  sword: {
    id: 'sword',
    name: 'Cardboard Spark Sword',
    slot: 'hand',
    scaleMm: 62,
    stats: { speed: 1, spin: 0, torque: 2, glow: 1 },
  },
  wings: {
    id: 'wings',
    name: 'Rainbow Sketch Wings',
    slot: 'wings',
    scaleMm: 52,
    stats: { speed: 2, spin: 1, torque: 0, glow: 2 },
  },
  crest: {
    id: 'crest',
    name: 'Lightning Crown Crest',
    slot: 'crown',
    scaleMm: 36,
    stats: { speed: 2, spin: 2, torque: 0, glow: 1 },
  },
};

export function renderKidPresetToCanvas(presetId = 'sword') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  // Warm white sketchbook paper background (so corner flood-fill segments it authentically!)
  ctx.fillStyle = '#fcfaf5';
  ctx.fillRect(0, 0, 256, 256);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (presetId === 'sword') {
    // Bold kid-drawn hero blade + star crossguard
    ctx.fillStyle = '#2E6FDB';
    ctx.strokeStyle = '#20232A';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(128, 20);
    ctx.lineTo(156, 62);
    ctx.lineTo(150, 174);
    ctx.lineTo(106, 174);
    ctx.lineTo(100, 62);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Central bright cyan energy stripe
    ctx.strokeStyle = '#8ef0ff';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(128, 42);
    ctx.lineTo(128, 162);
    ctx.stroke();

    // Coral & Gold crossguard + pommel
    ctx.fillStyle = '#FFB830';
    ctx.strokeStyle = '#20232A';
    ctx.lineWidth = 6;
    roundRect(ctx, 68, 170, 120, 26, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FF6B4A';
    roundRect(ctx, 112, 196, 32, 40, 10);
    ctx.fill();
    ctx.stroke();
    drawStar(ctx, 128, 183, 5, 14, 6, '#FF6B4A');
  } else if (presetId === 'wings') {
    // Single bold right-wing sketch (mirrored automatically into flapping Left + Right wings!)
    const grad = ctx.createLinearGradient(40, 40, 224, 210);
    grad.addColorStop(0, '#FF6B4A');
    grad.addColorStop(0.5, '#FFB830');
    grad.addColorStop(1, '#1FA6A0');
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#20232A';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(42, 140);
    ctx.bezierCurveTo(46, 56, 152, 24, 222, 48);
    ctx.bezierCurveTo(234, 88, 198, 126, 172, 134);
    ctx.bezierCurveTo(206, 154, 196, 206, 144, 220);
    ctx.bezierCurveTo(96, 228, 52, 192, 42, 140);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    drawStar(ctx, 148, 92, 5, 22, 10, '#ffffff');
    ctx.fillStyle = '#7C4DFF';
    ctx.beginPath();
    ctx.arc(132, 172, 16, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Lightning Crown Crest
    ctx.fillStyle = '#FFB830';
    ctx.strokeStyle = '#FF6B4A';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(148, 22);
    ctx.lineTo(72, 134);
    ctx.lineTo(126, 134);
    ctx.lineTo(96, 232);
    ctx.lineTo(188, 112);
    ctx.lineTo(134, 112);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  return c;
}

export function segmentForegroundMask(sourceCanvas, threshold = 38) {
  const W = 96, H = 96;
  const work = document.createElement('canvas');
  work.width = W;
  work.height = H;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(sourceCanvas, 0, 0, W, H);
  const img = wctx.getImageData(0, 0, W, H);
  const d = img.data;

  // Check if image already has a transparent background
  let transparentCount = 0;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 128) transparentCount++;
  }

  const bg = new Uint8Array(W * H);
  if (transparentCount > W * H * 0.1) {
    for (let p = 0; p < W * H; p++) {
      if (d[p * 4 + 3] < 128) bg[p] = 1;
    }
  } else {
    // Sample average corner color (4 corners, 3x3 patches)
    let sr = 0, sg = 0, sb = 0, cnt = 0;
    for (const [cx, cy] of [[1, 1], [W - 2, 1], [1, H - 2], [W - 2, H - 2]]) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const idx = ((cy + dy) * W + (cx + dx)) * 4;
          sr += d[idx]; sg += d[idx + 1]; sb += d[idx + 2];
          cnt++;
        }
      }
    }
    const br = sr / cnt, bgc = sg / cnt, bb = sb / cnt;
    const thrSq = (threshold * 1.95) ** 2;

    // Corner-seeded flood fill
    const queue = new Int32Array(W * H);
    let qHead = 0, qTail = 0;
    const seed = (x, y) => {
      const p = y * W + x;
      if (bg[p]) return;
      const idx = p * 4;
      const distSq = (d[idx] - br) ** 2 + (d[idx + 1] - bgc) ** 2 + (d[idx + 2] - bb) ** 2;
      if (distSq <= thrSq) {
        bg[p] = 1;
        queue[qTail++] = p;
      }
    };
    for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
    for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }

    while (qHead < qTail) {
      const p = queue[qHead++];
      const x = p % W, y = (p / W) | 0;
      if (x > 0) seed(x - 1, y);
      if (x < W - 1) seed(x + 1, y);
      if (y > 0) seed(x, y - 1);
      if (y < H - 1) seed(x, y + 1);
    }
  }

  // Foreground mask (with 1-px border margin so contour always closes cleanly!)
  const fg = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const p = y * W + x;
      if (!bg[p]) fg[p] = 1;
    }
  }

  // 1-pass 3x3 morphological closing to bridge thin gaps
  const closed = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) sum += fg[(y + dy) * W + (x + dx)];
      }
      closed[y * W + x] = sum >= 4 ? 1 : 0;
    }
  }

  // Keep largest connected foreground component
  const bestMask = keepLargestComponent(closed, W, H);

  // Build crisp cutout preview canvas
  const prev = document.createElement('canvas');
  prev.width = W;
  prev.height = H;
  const pctx = prev.getContext('2d');
  const outImg = pctx.createImageData(W, H);
  let fgCount = 0;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (bestMask[p]) {
      outImg.data[i] = d[i];
      outImg.data[i + 1] = d[i + 1];
      outImg.data[i + 2] = d[i + 2];
      outImg.data[i + 3] = 255;
      fgCount++;
    } else {
      outImg.data[i] = 28;
      outImg.data[i + 1] = 34;
      outImg.data[i + 2] = 52;
      outImg.data[i + 3] = 34;
    }
  }
  pctx.putImageData(outImg, 0, 0);

  return { mask: bestMask, width: W, height: H, previewCanvas: prev, fgCount };
}

function keepLargestComponent(mask, W, H) {
  const vis = new Uint8Array(W * H);
  const q = new Int32Array(W * H);
  let best = [];
  for (let p = 0; p < W * H; p++) {
    if (!mask[p] || vis[p]) continue;
    let h = 0, t = 0;
    vis[p] = 1;
    q[t++] = p;
    const comp = [];
    while (h < t) {
      const cur = q[h++];
      comp.push(cur);
      const x = cur % W, y = (cur / W) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
          const np = ny * W + nx;
          if (mask[np] && !vis[np]) {
            vis[np] = 1;
            q[t++] = np;
          }
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  const out = new Uint8Array(W * H);
  for (const p of best) out[p] = 1;
  return out;
}

// Moore-Neighbor outer boundary trace -> Douglas-Peucker -> Chaikin smoothing
function traceBoundaryContour(mask, W, H) {
  let startX = -1, startY = -1;
  for (let y = 1; y < H - 1 && startX < 0; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (mask[y * W + x]) { startX = x; startY = y; break; }
    }
  }
  if (startX < 0) {
    // Fallback rounded circle if blank image
    const pts = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      pts.push([W / 2 + Math.cos(a) * 26, H / 2 + Math.sin(a) * 26]);
    }
    return pts;
  }

  // Clockwise 8-neighborhood offsets
  const dirs = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const contour = [[startX, startY]];
  let cx = startX, cy = startY, backDir = 0;
  for (let step = 0; step < W * H * 2; step++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const dIdx = (backDir + 1 + k) % 8;
      const nx = cx + dirs[dIdx][0];
      const ny = cy + dirs[dIdx][1];
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && mask[ny * W + nx]) {
        cx = nx; cy = ny;
        backDir = (dIdx + 4) % 8;
        found = true;
        break;
      }
    }
    if (!found || (cx === startX && cy === startY && contour.length > 4)) break;
    contour.push([cx, cy]);
  }
  return contour;
}

function simplifyDP(pts, eps) {
  if (pts.length <= 4) return pts;
  let maxDist = 0, idx = 0;
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    let t = lenSq > 1e-6 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const dist = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    if (dist > maxDist) { maxDist = dist; idx = i; }
  }
  if (maxDist > eps) {
    const left = simplifyDP(pts.slice(0, idx + 1), eps);
    const right = simplifyDP(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

function chaikinClosed(pts, passes = 1) {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const next = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    cur = next;
  }
  return cur;
}

export async function trySamScanEndpoint(sourceCanvas) {
  try {
    const dataUrl = sourceCanvas.toDataURL('image/png');
    const resp = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    if (!resp.ok) return { ok: false, message: `/api/scan returned ${resp.status} — using instant local cutout` };
    const json = await resp.json();
    return { ok: true, data: json, message: 'Segmented with SAM 3.1!' };
  } catch {
    return { ok: false, message: 'SAM /api/scan offline in static viewer — using <15 ms local cutout' };
  }
}

export function buildPhotoAccessoryMesh(THREE, sourceCanvas, seg, opts = {}) {
  const {
    slot = 'hand',
    thicknessMm = 5.0,
    scaleMm = 54.0,
    rimColor = '#ff6b4a',
    stats = { speed: 1, spin: 1, torque: 1, glow: 1 },
  } = opts;

  const { mask, width: W, height: H } = seg;
  const rawLoop = traceBoundaryContour(mask, W, H);
  const halfIdx = Math.floor(rawLoop.length / 2);
  const simplified = simplifyDP(rawLoop.slice(0, halfIdx + 1), 1.45)
    .slice(0, -1)
    .concat(simplifyDP(rawLoop.slice(halfIdx).concat([rawLoop[0]]), 1.45).slice(0, -1));
  const smoothPx = chaikinClosed(simplified.length >= 4 ? simplified : rawLoop, 1);

  // Bounding box in mask pixel space -> map to physical mm AND exact [0..1] image UVs!
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const [px, py] of smoothPx) {
    if (px < xMin) xMin = px;
    if (px > xMax) xMax = px;
    if (py < yMin) yMin = py;
    if (py > yMax) yMax = py;
  }
  const spanPx = Math.max(8, Math.max(xMax - xMin, yMax - yMin));
  const mmPerPx = scaleMm / spanPx;
  const cxPx = 0.5 * (xMin + xMax);

  // Build THREE.Shape in (x_mm, y_mm) with bottom of silhouette at y_mm = 0!
  const shape = new THREE.Shape();
  smoothPx.forEach(([px, py], idx) => {
    const xm = (px - cxPx) * mmPerPx;
    const ym = (yMax - py) * mmPerPx;
    if (idx === 0) shape.moveTo(xm, ym);
    else shape.lineTo(xm, ym);
  });
  shape.closePath();

  const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
    depth: thicknessMm,
    bevelEnabled: true,
    bevelThickness: 0.85,
    bevelSize: 0.75,
    bevelSegments: 2,
    curveSegments: 2,
  });
  extrudeGeo.translate(0, 0, -thicknessMm * 0.5);
  extrudeGeo.computeVertexNormals();

  // Map planar UVs directly back to `sourceCanvas` [0..1] so front & back show crisp photo art!
  const posAttr = extrudeGeo.attributes.position;
  const uvAttr = extrudeGeo.attributes.uv;
  for (let i = 0; i < posAttr.count; i++) {
    const xm = posAttr.getX(i);
    const ym = posAttr.getY(i);
    const px = xm / mmPerPx + cxPx;
    const py = yMax - ym / mmPerPx;
    uvAttr.setXY(i, Math.max(0, Math.min(1, px / W)), Math.max(0, Math.min(1, 1 - py / H)));
  }
  uvAttr.needsUpdate = true;

  const tex = new THREE.CanvasTexture(sourceCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const faceMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.42,
    metalness: 0.02,
  });
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: rimColor,
    roughness: 0.34,
    clearcoat: 0.42,
  });

  const root = new THREE.Group();
  const triCount = Math.round(posAttr.count / 3);

  if (slot === 'wings') {
    // Double flapping back wings mounted on a Coral Spark 2x2 hub!
    const hub = new THREE.Mesh(new THREE.BoxGeometry(22, 16, 5), rimMat);
    hub.castShadow = true;
    root.add(hub);

    const leftPivot = new THREE.Group();
    leftPivot.position.set(8, 2, -2);
    const leftMesh = new THREE.Mesh(extrudeGeo, [faceMat, rimMat]);
    leftMesh.castShadow = true;
    leftMesh.position.set(scaleMm * 0.36, -scaleMm * 0.32, 0);
    leftPivot.add(leftMesh);

    const rightPivot = new THREE.Group();
    rightPivot.position.set(-8, 2, -2);
    const rightMesh = new THREE.Mesh(extrudeGeo, [faceMat, rimMat]);
    rightMesh.castShadow = true;
    rightMesh.scale.x = -1;
    rightMesh.position.set(-scaleMm * 0.36, -scaleMm * 0.32, 0);
    rightPivot.add(rightMesh);

    root.add(leftPivot, rightPivot);
    root.userData = { digitalOnly: true, prints: false, slot, stats, triCount: triCount * 2, leftPivot, rightPivot };
    return root;
  }

  const bodyMesh = new THREE.Mesh(extrudeGeo, [faceMat, rimMat]);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;

  if (slot === 'hand') {
    // Visual Ø 6.60 mm Coral Spark handle along +X (matching Kip's rightHandCgripParent!)
    const grip = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 28, 20), rimMat);
    handle.castShadow = true;
    handle.position.y = 12;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 4, 20), rimMat);
    collar.position.y = 25;
    bodyMesh.position.y = 26;
    grip.add(handle, collar, bodyMesh);
    // Align +Y blade along Kip's hand grip +X axis!
    grip.rotation.z = -Math.PI / 2;
    grip.position.set(-12, -11.4, 2.3);
    root.add(grip);
  } else if (slot === 'crown') {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(23.6, 5.0, 11.6), rimMat);
    pad.position.y = 2.5;
    pad.castShadow = true;
    bodyMesh.position.y = 4.2;
    root.add(pad, bodyMesh);
  } else if (slot === 'hood') {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(23.6, 5.5, 23.6), rimMat);
    pad.position.y = 2.75;
    pad.castShadow = true;
    bodyMesh.position.y = 4.8;
    root.add(pad, bodyMesh);
  }

  root.userData = { digitalOnly: true, prints: false, slot, stats, triCount };
  return root;
}

export function encodeToyContractHash(state) {
  const payload = {
    format: 'toyventor.toy/1',
    id: `kip-${state.head || 'classic'}`,
    name: state.name || 'Kip Custom Loadout',
    kind: state.vehicle && state.vehicle !== 'none' ? 'vehicle' : 'figure',
    prints: !state.hasPhotoAccessory,
    col: { c1: '#f4efe6', c2: '#ff6b4a' },
    parts: state.parts || [],
    stats: state.stats || { speed: 2, spin: 2, torque: 2, glow: 2 },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `#toy=${b64}`;
}
