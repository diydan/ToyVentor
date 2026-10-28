import { useState } from "react";
import type { Part } from "../../../shared/part";
import type { Toy } from "../../../shared/toy";
import { PartPreview } from "./PartPreview";

/**
 * AR try-on v1: the part's real GLB composited over the toy's own photo,
 * cropped to the SAM outline so true scale stays legible. Approximate by
 * construction (a photo has perspective); labelled as a preview, not a
 * fit promise. Without a photo it degrades to the plain 3D viewer.
 */
export function TryOn({
  toy,
  part,
  glbFile,
}: {
  toy: Toy;
  part: Part;
  glbFile: string;
}) {
  const [imgAspect, setImgAspect] = useState(1.5);
  if (!toy.imageDataUrl) return <PartPreview glbFile={glbFile} partName={part.name} />;

  // No SAM outline (seed/manual toy): middle of the photo stands in.
  const outline = toy.outline ?? { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.8 };
  const ow = outline.x2 - outline.x1;
  const oh = outline.y2 - outline.y1;

  // Crop to the outline with headroom, clamped to the photo.
  const padX = ow * 0.55;
  const padY = oh * 0.75;
  const cropX = Math.max(0, outline.x1 - padX);
  const cropY = Math.max(0, outline.y1 - padY);
  const cropW = Math.min(1, outline.x2 + padX) - cropX;
  const cropH = Math.min(1, outline.y2 + padY * 0.5) - cropY;
  const inCrop = (v: number, from: number, span: number) => ((v - from) / span) * 100;

  // Part size inside the crop, from the toy's real scale along the
  // outline's longest side, exactly as the scan derived its millimetres.
  const perMmX = ow / Math.max(toy.widthMm, 1);
  const overlayW = ((part.footprintMm[0] * perMmX) / cropW) * 100;
  const overlayH = Math.min(80, overlayW * 0.85);
  const cx = inCrop((outline.x1 + outline.x2) / 2, cropX, cropW);
  const anchorY = inCrop(outline.y1 + oh * 0.16, cropY, cropH);

  return (
    <div>
      <div
        className="tryon"
        style={{ aspectRatio: `${((cropW * imgAspect) / Math.max(cropH, 0.01)).toFixed(3)}` }}
      >
        <img
          src={toy.imageDataUrl}
          alt={toy.name}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalHeight > 0) setImgAspect(img.naturalWidth / img.naturalHeight);
          }}
          style={{
            position: "absolute",
            width: `${100 / cropW}%`,
            height: `${100 / cropH}%`,
            left: `${inCrop(0, cropX, cropW)}%`,
            top: `${inCrop(0, cropY, cropH)}%`,
            maxWidth: "none",
          }}
        />
        <div
          className="tryon-outline"
          style={{
            left: `${inCrop(outline.x1, cropX, cropW)}%`,
            top: `${inCrop(outline.y1, cropY, cropH)}%`,
            width: `${(ow / cropW) * 100}%`,
            height: `${(oh / cropH) * 100}%`,
          }}
        />
        <div
          className="tryon-part"
          style={{
            left: `${cx - overlayW / 2}%`,
            top: `${Math.max(0, anchorY - overlayH * 0.65)}%`,
            width: `${overlayW}%`,
            height: `${overlayH}%`,
          }}
        >
          <PartPreview
            glbFile={glbFile}
            partName={part.name}
            fill
            cameraOrbit={`40deg 62deg ${(Math.max(...part.footprintMm) * 2.6) / 1000}m`}
          />
        </div>
      </div>
      <p className="fine-print">
        {toy.outline
          ? "Zoomed to SAM's outline of your toy, part at footprint scale. Photo perspective makes this a preview, not a fit guarantee."
          : "No SAM outline for this toy yet, so the part sits mid-photo as a rough preview. Scan it with SAM for a placed fit."}
      </p>
    </div>
  );
}
