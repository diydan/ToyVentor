import { plateHalfWidth } from './kip-faceplate-shape.js?v=10.0';

// ToyVentor Kip Expansion Helpers:
//   1) 2D Decal Expression Skins (`BRAND_STYLE.md` rule 5: zero moulded 3D faces)
//   2) Phase 4 Photo-to-Accessory Forge (`prints: false` digital-only game accessories)
//   3) `#toy=` ToyContract URL encoder & LLM PartSpec Prompt loader

export const DECAL_EXPRESSIONS = [
  { id: 'spark',     label: 'Spark' },
  { id: 'button',    label: 'Button Eyes' },
  { id: 'happy',     label: 'Happy' },
  { id: 'wink',      label: 'Wink' },
  { id: 'cool',      label: 'Cool Shades' },
  { id: 'starry',    label: 'Starry' },
  { id: 'surprised', label: 'Surprised' },
  { id: 'blank',     label: 'Blank Plate' },
];

// Selfie face (kip-selfie.js): the single canvas lives here, in memory only, and `expr: 'selfie'` returns it.
// It is never serialised, stored, or sent anywhere; clearing it (setSelfieCanvas(null)) drops the pixels.
let selfieCanvas = null;
export function setSelfieCanvas(canvas) { selfieCanvas = canvas ?? null; }
export function hasSelfieCanvas() { return selfieCanvas !== null; }

/** `onPlate`: the art goes on the rounded human face plate (not the classic head's visor), so it is kept inside the plate outline. */
/**
 * Eye positions on the human face plate, mm either side of the centre line (the plate is 24.2 mm wide, so a human-proportioned pair is
 * about 45-50% of that apart, centre to centre). The vinyl value is the physical dome position (FACE_VINYL_EYE_X in
 * parts/partspec/toyventor_parts.py, checked by tests/kip-faceplate-shape.test.ts); the others are printed art. Before 2026-11-01 they were
 * vinyl 7.3, sculpted 7.0, flat button 7.1 and flat 6.2: 54-60% of the plate width, which read as wide-set.
 * The vinyl domes are moulded (FACE_VINYL_EYE_X in the CAD, now 6.0 mm, moved from 7.3 with the 2026-11-01 regeneration): set both together,
 * a test fails if the painted irises and the domes disagree.
 */
export const FACEPLATE_EYE_MM = { vinyl: 6.0, flatButton: 5.8, flat: 5.3, sculpted: 5.8 };
const MM_PX = 21.69; // art px per mm across the plate: x = 256 +- mm * 21.69
const eyePair = (mm) => [Math.round(256 - mm * MM_PX), Math.round(256 + mm * MM_PX)];
const FACEPLATE_EYE_PX = Object.fromEntries(Object.entries(FACEPLATE_EYE_MM).map(([k, v]) => [k, eyePair(v)]));
/** The classic head's visor plane has its own scale, so its art keeps the original positions. */
const LEGACY_EYE_PX = { vinyl: [98, 414], flatButton: [102, 410], flat: [122, 390], sculpted: [104, 408] };

export function createDecalExpressionCanvas(expression = 'spark', headType = 'kid', insertMode = 'sculpted', { onPlate = false } = {}) {
  if (expression === 'selfie' && selfieCanvas) return selfieCanvas;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (expression === 'blank') return c;

  const isRobot = headType === 'robot' || headType === 'scout';
  const isMuzzled = headType === 'fox' || headType === 'bear' || headType === 'cat';
  const isCreature = headType === 'dragon' || headType === 'alien' || headType === 'imp';
  const isAnimal = isMuzzled || isCreature;
  const isHuman = !isRobot && !isAnimal;
  const isVinylInsert = isHuman && insertMode === 'vinyl';
  const isFlatHuman = isHuman && insertMode === 'flat';
  const useButtonEyes = isHuman && (isVinylInsert || expression === 'button');
  // Face cues that carry the gender read on top of the head shapes (kid = neutral, chibi = feminine, tall = masculine): brows and lashes.
  const isFemaleHead = isHuman && headType === 'chibi';
  const isMaleHead = isHuman && headType === 'tall';

  // Dark LED visor screen ONLY for Robot head; Human & Critter heads use visor-free transparent decal skin!
  if (isRobot) {
    ctx.fillStyle = '#161d30';
    roundRect(ctx, 36, 36, 440, 184, 82);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(184, 232, 255, 0.38)';
    ctx.stroke();
    if (headType === 'scout') {
      // Mecha Scout panoramic HUD: amber range ticks along the lower edge and faint scan lines
      ctx.strokeStyle = 'rgba(255, 184, 48, 0.55)';
      ctx.lineWidth = 5;
      for (let tx = 96; tx <= 416; tx += 32) {
        ctx.beginPath();
        ctx.moveTo(tx, 196);
        ctx.lineTo(tx, tx % 64 === 0 ? 178 : 186);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(184, 232, 255, 0.10)';
      ctx.lineWidth = 3;
      for (let ty = 62; ty < 170; ty += 18) {
        ctx.beginPath();
        ctx.moveTo(70, ty);
        ctx.lineTo(442, ty);
        ctx.stroke();
      }
    }
  }

  // Soft cream muzzle mask + button nose + critter mouth for Fox & Bear
  if (isMuzzled) {
    ctx.fillStyle = 'rgba(252, 246, 236, 0.94)';
    ctx.beginPath();
    ctx.ellipse(256, 178, headType === 'bear' ? 92 : (headType === 'cat' ? 88 : 82), 56, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const creatureEye = { dragon: '#E8A317', alien: '#0E1230', imp: '#2A1608' }[headType];
  const eyeCol = isRobot ? '#b8e8ff' : (creatureEye || (useButtonEyes ? '#151211' : '#241814'));
  const mouthCol = isRobot ? '#b8e8ff' : '#3B221B';
  const glintCol = '#ffffff';
  const cheekCol = '#ff6b4a';

  // Universal 24.2 x 10.5 mm faceplate mapping (`23.6 x 10.1 mm` conformal plane centered at `zb = 5.25 mm`):
  //   - `vinyl` (`char_faceplate_vinyl`): physical 3D button-eye domes sit at `x = ±6.00 mm (FACE_VINYL_EYE_X), zb = 5.45 mm` -> `px = [126, 386], py = 123`!
  //   - `sculpted` (`char_faceplate`): eye planes sit at `x = ±5.80 mm, zb = 5.96 mm` -> `px = [130, 382], py = 110`!
  //   - `flat` (`char_faceplate_flat`): smooth flush printed-decal figure layout -> `px = [141, 371], py = 114`!
  // On the human face plate the eyes are brought in (FACEPLATE_EYE_MM) so they sit about half a face width apart, like a human face;
  // the classic head shares this art but has its own visor plane, so it keeps its original spacing.
  const eyeTable = onPlate ? FACEPLATE_EYE_PX : LEGACY_EYE_PX;
  const humanEyeX = isVinylInsert
    ? eyeTable.vinyl
    : (isFlatHuman ? (expression === 'button' ? eyeTable.flatButton : eyeTable.flat) : eyeTable.sculpted);
  const humanEyeY = isVinylInsert ? 123 : (isFlatHuman ? 114 : 110);
  const humanBrowY = isVinylInsert ? 36 : (isFlatHuman ? 48 : 44);
  // All three human inserts carry the same moulded resting-smile ridge (`FACE_MOUTH` in toyventor_parts.py: +-2.5 mm wide, vertex zb 1.25 mm,
  // corners 0.5 mm higher). Decal row = (10.3 - zb) * 25.35, column = 256 + x * 21.69, so the dark smile line lands exactly on the ridge crest.
  const humanMouthY = 224;
  const drawRidgeSmile = (lineWidth = 12) => {
    ctx.strokeStyle = mouthCol;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(201.8, 216.7);
    ctx.quadraticCurveTo(256, 242.1, 310.2, 216.7);
    ctx.stroke();
  };

  // Signature Coral Spark cheek blushes (strictly on the universal faceplate, never on the head!)
  ctx.fillStyle = cheekCol;
  if (isVinylInsert) {
    ctx.globalAlpha = 0.54;
    drawCapsule(ctx, onPlate ? 86 : 36, 204, 42, 18);
    drawCapsule(ctx, onPlate ? 426 : 476, 204, 42, 18);
    ctx.globalAlpha = 1.0;
  } else if (isFlatHuman) {
    ctx.globalAlpha = 0.66;
    drawCapsule(ctx, onPlate ? 62 : 64, 168, 46, 22);
    drawCapsule(ctx, onPlate ? 450 : 448, 168, 46, 22);
    ctx.globalAlpha = 1.0;
  } else if (isHuman) {
    for (const bx of onPlate ? [78, 434] : [46, 466]) {
      const rg = ctx.createRadialGradient(bx, 174, 4, bx, 174, 30);
      rg.addColorStop(0, 'rgba(255, 107, 74, 0.55)');
      rg.addColorStop(0.65, 'rgba(255, 118, 92, 0.24)');
      rg.addColorStop(1, 'rgba(255, 118, 92, 0.0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.ellipse(bx, 174, 30, 17, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.globalAlpha = isAnimal ? 0.74 : 0.90;
    drawCapsule(ctx, 84, 176, 52, 24);
    drawCapsule(ctx, 428, 176, 52, 24);
    ctx.globalAlpha = 1.0;
  }

  // Expressive human eyebrows on the faceplate
  if (isHuman) {
    ctx.strokeStyle = 'rgba(54, 32, 22, 0.90)';
    // Masculine: heavier, flatter, slightly lower brows. Feminine: finer, higher, more arched brows. Neutral: unchanged.
    ctx.lineWidth = (isVinylInsert ? 9.5 : (isFlatHuman ? 10.5 : 9.5)) + (isMaleHead ? 4.0 : (isFemaleHead ? -2.5 : 0));
    ctx.lineCap = 'round';
    const browR = isMaleHead ? 54 : (isFemaleHead ? 33 : (isVinylInsert ? 40 : 38));
    const browA0 = Math.PI * (isMaleHead ? 1.30 : (isFemaleHead ? 1.17 : 1.22));
    const browA1 = Math.PI * (isMaleHead ? 1.70 : (isFemaleHead ? 1.83 : 1.78));
    const browDy = isMaleHead ? 5 : (isFemaleHead ? -5 : 0);
    for (const [bx, dir] of [[humanEyeX[0], -1], [humanEyeX[1], 1]]) {
      ctx.beginPath();
      const lift = expression === 'surprised'
        ? -10
        : (expression === 'cool' ? -6 : (expression === 'wink' && dir === 1 ? 8 : 0));
      ctx.arc(bx, humanBrowY + lift + browDy + (isMaleHead ? 14 : 0), browR, browA0, browA1);
      ctx.stroke();
    }
  }

  // Subtle 2D printed triangle nose shading ONLY when `flat` insert uses `button` expression
  // (on `vinyl` and `sculpted` inserts, the physical 3D nose prism is left 100% unpainted skin-tone!)
  if (isFlatHuman && expression === 'button') {
    ctx.fillStyle = 'rgba(92, 48, 28, 0.22)';
    ctx.beginPath();
    ctx.moveTo(256, 134);
    ctx.lineTo(292, 162);
    ctx.lineTo(220, 162);
    ctx.closePath();
    ctx.fill();
  }

  // Cute stylized button nose tip for Fox / Bear (2D decal only — zero 3D nostril holes!)
  if (isMuzzled) {
    ctx.fillStyle = headType === 'cat' ? '#F28AA0' : '#20232A';
    ctx.beginPath();
    if (headType === 'cat') {
      ctx.moveTo(232, 144);
      ctx.lineTo(280, 144);
      ctx.lineTo(256, 168);
      ctx.closePath();
    } else {
      ctx.ellipse(256, 154, headType === 'bear' ? 26 : 21, 15, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(249, 149, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const eyeCenters = isHuman ? humanEyeX : [152, 360];

  const drawHumanOrCritterEye = (cx, cy = humanEyeY, side = 0) => {
    if (useButtonEyes) {
      // Wide-set glossy dark circular button eyes (`rx = 56, ry = 65` -> true Ø 5.16 mm 3D circle over `char_faceplate_vinyl` domes!)
      const rx = isVinylInsert ? 56 : 50;
      const ry = isVinylInsert ? 65 : 58;
      ctx.fillStyle = eyeCol;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      // Glossy vinyl button rim sheen
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
      ctx.lineWidth = 4.8;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx - 6, ry - 7, 0, Math.PI * 1.12, Math.PI * 1.78);
      ctx.stroke();
      // Crisp specular button catchlights
      ctx.fillStyle = glintCol;
      ctx.beginPath();
      ctx.ellipse(cx - 16, cy - 18, 13.5, 15.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 15, cy + 17, 6.0, 7.0, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (isFlatHuman) {
      // Classic bold printed-decal figure eyes (crisp dark oval + dual white catchlights)
      ctx.fillStyle = eyeCol;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 34, 42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = glintCol;
      ctx.beginPath();
      ctx.ellipse(cx - 11, cy - 14, 11.5, 13.0, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 11, cy + 13, 5.2, 6.0, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (isHuman) {
      // Crisp expressive human eye oval + warm iris + curved upper eyelash line
      ctx.fillStyle = eyeCol;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 36, 43, 0, 0, Math.PI * 2);
      ctx.fill();

      // Warm chestnut-amber iris crescent
      ctx.fillStyle = '#8B5437';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 17, 24, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#BA7D56';
      ctx.beginPath();
      ctx.ellipse(cx + 3, cy + 20, 15, 7.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Re-deepen pupil center
      ctx.fillStyle = eyeCol;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 2, 18.5, 21.0, 0, 0, Math.PI * 2);
      ctx.fill();

      // Soft upper eyelash sweep
      ctx.strokeStyle = eyeCol;
      ctx.lineWidth = isFemaleHead ? 10.5 : (isMaleHead ? 5.0 : 8.0);   // bolder lashes on the feminine head, a plain lid line on the masculine one
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy + 4, 38, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      if (side !== 0 && !isMaleHead) {
        ctx.beginPath();
        ctx.moveTo(cx + side * 33, cy - 12);
        ctx.lineTo(cx + side * (isFemaleHead ? 50 : 42), cy - (isFemaleHead ? 29 : 20));
        ctx.stroke();
      }

      // Twin lively catchlights
      ctx.fillStyle = glintCol;
      ctx.beginPath();
      ctx.ellipse(cx - 12, cy - 14, 11.8, 13.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 12, cy + 13, 5.4, 6.2, 0, 0, Math.PI * 2);
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

  if (expression === 'button') {
    const eY = isHuman ? humanEyeY : 124;
    drawHumanOrCritterEye(eyeCenters[0], eY, -1);
    drawHumanOrCritterEye(eyeCenters[1], eY, 1);
    if (!isHuman) {
      ctx.strokeStyle = mouthCol;
      ctx.lineWidth = 8.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(256, 174, 24, 0.16 * Math.PI, 0.84 * Math.PI);
      ctx.stroke();
    }
  } else if (expression === 'spark') {
    const eY = isHuman ? humanEyeY : 124;
    drawHumanOrCritterEye(eyeCenters[0], eY, -1);
    drawHumanOrCritterEye(eyeCenters[1], eY, 1);
    if (isHuman) {
      drawRidgeSmile(12);
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
      ctx.arc(cx, isHuman ? humanEyeY + 14 : 138, isHuman ? (isVinylInsert ? 42 : 34) : 37, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
    if (isHuman) {
      const mTop = humanMouthY - (isVinylInsert ? 8 : 12);
      const mRad = isVinylInsert ? 22 : 28;
      ctx.save();
      ctx.beginPath();
      ctx.arc(256, mTop, mRad, 0, Math.PI, false);
      ctx.closePath();
      ctx.fillStyle = mouthCol;
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(222, mTop - 2, 68, 8);
      ctx.fillStyle = '#FF7E6B';
      ctx.beginPath();
      ctx.ellipse(256, mTop + mRad * 0.82, 16, 9, 0, 0, Math.PI * 2);
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
    drawHumanOrCritterEye(eyeCenters[0], isHuman ? humanEyeY : 124, -1);

    ctx.strokeStyle = eyeCol;
    ctx.lineWidth = isHuman ? 13.0 : 14;
    ctx.lineCap = 'round';
    const wx = eyeCenters[1];
    ctx.beginPath();
    ctx.arc(wx, isHuman ? humanEyeY + 12 : 136, isHuman ? (isVinylInsert ? 40 : 32) : 35, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
    if (isHuman && !isFlatHuman && !useButtonEyes) {
      ctx.lineWidth = 7.5;
      ctx.beginPath();
      ctx.moveTo(wx + 29, humanEyeY);
      ctx.lineTo(wx + 39, humanEyeY - 8);
      ctx.stroke();
    }

    if (isHuman) {
      drawRidgeSmile(12);
    } else {
      ctx.strokeStyle = mouthCol;
      ctx.lineWidth = isFlatHuman ? 11.0 : 9.0;
      ctx.beginPath();
      ctx.arc(262, 169, 32, 0.16 * Math.PI, 0.82 * Math.PI);
      ctx.stroke();
    }
  } else if (expression === 'cool') {
    if (isHuman) {
      // the lenses sit a little inside the eyes (none on the vinyl domes, 14 px on flat, 8 px on sculpted), whatever the eye spacing
      const shadeBase = isVinylInsert ? eyeTable.vinyl : (isFlatHuman ? eyeTable.flat : eyeTable.sculpted);
      const shadeIn = isVinylInsert ? 0 : (isFlatHuman ? 14 : 8);
      const shadeX = [shadeBase[0] + shadeIn, shadeBase[1] - shadeIn];
      const shadeRx = isVinylInsert ? 58 : 66;
      const shadeRy = isVinylInsert ? 62 : 40;
      for (const lx of shadeX) {
        const lg = ctx.createLinearGradient(lx, humanEyeY - shadeRy, lx, humanEyeY + shadeRy);
        lg.addColorStop(0, 'rgba(34, 39, 54, 0.94)');
        lg.addColorStop(1, 'rgba(72, 48, 62, 0.88)');
        ctx.fillStyle = lg;
        ctx.strokeStyle = '#241B18';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.ellipse(lx, humanEyeY, shadeRx, shadeRy, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,255,255,0.68)';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(lx - 26, humanEyeY + 20);
        ctx.lineTo(lx - 2, humanEyeY - 22);
        ctx.stroke();
      }
      ctx.strokeStyle = '#241B18';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(256, humanEyeY - 6, isVinylInsert ? 62 : 44, Math.PI * 1.15, Math.PI * 1.85);
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
    // Confident smirk (humans: the moulded smile ridge, drawn from the vertex to the right corner for a one-sided grin)
    if (isHuman) {
      ctx.strokeStyle = mouthCol;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(256, 229.4);
      ctx.quadraticCurveTo(283, 229.4, 310.2, 216.7);
      ctx.stroke();
    } else {
      ctx.strokeStyle = isRobot ? '#FFB830' : mouthCol;
      ctx.lineWidth = 9.0;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(262, 174, 30, 0.16 * Math.PI, 0.76 * Math.PI);
      ctx.stroke();
    }
  } else if (expression === 'starry') {
    if (isHuman) {
      const rx = isVinylInsert ? 56 : 36;
      const ry = isVinylInsert ? 65 : 42;
      for (const cx of eyeCenters) {
        ctx.fillStyle = eyeCol;
        ctx.beginPath();
        ctx.ellipse(cx, humanEyeY, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        drawStar(ctx, cx, humanEyeY, 5, isVinylInsert ? 30 : 24, isVinylInsert ? 13 : 11, '#FFB830');
        drawStar(ctx, cx - 13, humanEyeY - 20, 4, 9.0, 3.5, '#ffffff');
      }
    } else {
      for (const cx of eyeCenters) {
        drawStar(ctx, cx, 120, 5, 40, 18, '#FFB830');
        drawStar(ctx, cx, 120, 4, 16, 6, '#ffffff');
      }
    }
    ctx.fillStyle = mouthCol;
    ctx.beginPath();
    ctx.ellipse(256, isHuman ? humanMouthY : 180, isHuman ? 13 : 18, isHuman ? 10 : 13, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (expression === 'surprised') {
    const eY = isHuman ? humanEyeY : 122;
    for (const cx of eyeCenters) {
      if (isHuman) {
        drawHumanOrCritterEye(cx, eY, 0);
      } else {
        ctx.fillStyle = eyeCol;
        ctx.beginPath();
        ctx.arc(cx, eY, 37, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = glintCol;
        ctx.beginPath();
        ctx.arc(cx - 10, eY - 11, 10.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + 10, eY + 10, 4.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const mY = isHuman ? humanMouthY : 181;
    ctx.fillStyle = mouthCol;
    ctx.beginPath();
    ctx.ellipse(256, mY, isHuman ? 13 : 18, isHuman ? 14 : 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FF7E6B';
    ctx.beginPath();
    ctx.ellipse(256, mY + 6, 8.5, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Head-specific printed details (all 2D decal only, so the 3D heads stay clean and support-free)
  const eyesVisible = expression !== 'happy' && expression !== 'cool';
  if (headType === 'cat') {
    // Three crisp whiskers per cheek
    ctx.strokeStyle = 'rgba(70, 48, 36, 0.82)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      for (const [dy, dx] of [[-10, 74], [4, 80], [18, 70]]) {
        ctx.beginPath();
        ctx.moveTo(256 + side * 78, 176 + dy * 0.4);
        ctx.lineTo(256 + side * (78 + dx), 176 + dy);
        ctx.stroke();
      }
    }
  } else if (headType === 'dragon') {
    ctx.fillStyle = '#16382A';
    if (eyesVisible) {
      for (const cx of eyeCenters) {
        roundRect(ctx, cx - 7, 90, 14, 68, 7);
        ctx.fill();
      }
    }
    // Twin snout nostrils + a playful little fang
    ctx.fillStyle = '#16382A';
    for (const nx of [236, 276]) {
      ctx.beginPath();
      ctx.ellipse(nx, 150, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#FFFFFF';
    for (const fx of [226, 286]) {
      ctx.beginPath();
      ctx.moveTo(fx - 8, 192);
      ctx.lineTo(fx + 8, 192);
      ctx.lineTo(fx, 212);
      ctx.closePath();
      ctx.fill();
    }
  } else if (headType === 'alien') {
    if (eyesVisible) {
      // Starry cosmic highlights inside the large midnight eyes
      for (const cx of eyeCenters) {
        drawStar(ctx, cx + 14, 104, 4, 12, 5, '#9FE8FF');
        drawStar(ctx, cx - 16, 140, 4, 7, 3, '#FFFFFF');
      }
    }
  } else if (headType === 'imp') {
    // Two upward underbite fangs
    ctx.fillStyle = '#FFFFFF';
    for (const fx of [218, 294]) {
      ctx.beginPath();
      ctx.moveTo(fx - 12, 214);
      ctx.lineTo(fx + 12, 214);
      ctx.lineTo(fx, 180);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (isHuman && onPlate) clipToFaceplate(ctx, c);
  return c;
}

/**
 * The human face plate is rounded, not a rectangle: clip the 2D art to the plate outline (pulled in 0.4 mm) so nothing hangs past
 * the edge onto the skull lip. Canvas px map to the decal plane as x = (px - 256) / 21.69 mm, zb = 10.3 - py / 25.35 mm.
 */
function clipToFaceplate(ctx, c) {
  const right = [], left = [];
  for (let row = 0; row <= c.height; row += 4) {
    const zb = 10.3 - row / 25.35;
    const hw = Math.max(0, plateHalfWidth(zb) - 0.4);
    right.push([256 + hw * 21.69, row]);
    left.push([256 - hw * 21.69, row]);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#000';
  ctx.beginPath();
  right.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = left.length - 1; i >= 0; i--) ctx.lineTo(left[i][0], left[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
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
