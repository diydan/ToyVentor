import seedCarJson from "../../../seed/toys/seed-car.json";
import seedFigureJson from "../../../seed/toys/seed-figure.json";
import seedKipJson from "../../../seed/toys/seed-kip.json";
import seedMotorbikeJson from "../../../seed/toys/seed-motorbike.json";
import seedScooterJson from "../../../seed/toys/seed-scooter.json";
import seedTruckJson from "../../../seed/toys/seed-truck.json";
import type { Toy } from "../../../shared/toy";
import { fetchScanToy, postScanToy, type ScanPostResult } from "../../lib/api";

// Single source of truth for the backup toys: the same JSON the Worker serves.
// Phase 2 canonical starter order: Kip (#1) + Red Racer (#2); Star Scout is
// grandfathered only when already active or customized on the device.
export const seedCar = seedCarJson as Toy;
export const seedFigure = seedFigureJson as Toy;
export const seedKip = seedKipJson as Toy;
// Verified Wave 9 V2 Maker Rank vehicles (Phase 4 §5.1 ready: true).
export const seedTruck = seedTruckJson as Toy;
export const seedScooter = seedScooterJson as Toy;
export const seedMotorbike = seedMotorbikeJson as Toy;
export const enabledStarterToys: Toy[] = [seedKip, seedCar];
export const backupToys: Toy[] = [seedKip, seedCar, seedFigure];

/** Backup path: try the scan route first (it serves the seed car today),
 *  fall back to the bundled copy so the demo works with the API down. */
export async function scanToy(): Promise<Toy> {
  try {
    return await fetchScanToy();
  } catch {
    return seedCar;
  }
}

/** Send a photographed/measured toy through the Worker for validation.
 *  Returns null when offline — the caller still keeps the toy locally. */
export async function submitScan(toy: Toy, prompt: string): Promise<ScanPostResult | null> {
  try {
    return await postScanToy(toy, prompt);
  } catch {
    return null;
  }
}

const MAX_PHOTO_EDGE = 512;

/** Downscale a camera photo to a small JPEG data URL for display and
 *  local storage. Full-res phone photos would blow the storage quota. */
export function downscalePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas unavailable"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not read that photo"));
    };
    img.src = url;
  });
}
