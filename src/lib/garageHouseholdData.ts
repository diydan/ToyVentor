// The household library as the Garage reads it: the catalog (the built items and the toy support tool) bundled into the app so the weekend rotation works
// offline, the household drop for a weekend (cached, so the Garage sees the same object every render), and the item pictures (a separate, lazily loaded
// chunk: they are only needed once the sheet opens). Both files are written by the library build (parts/kip/household/build_household.py); nothing here
// edits them.

import catalog from "../../public/kip/household/catalog.json";
import type { GarageDrop } from "./garage";
import { householdDropFor, type HouseholdItem } from "./garageHousehold";

export interface CatalogRow {
  id: string;
  label: string;
  tags: string[];
  minBand: number;
  simple: boolean;
  group: string;
  confusableWith?: string[];
  built: boolean;
}

/** A catalog row as the Garage reads it: just the fields the rules use. */
export const slim = (r: CatalogRow): HouseholdItem => ({
  id: r.id,
  label: r.label,
  tags: r.tags,
  minBand: r.minBand,
  simple: r.simple,
  group: r.group,
  confusableWith: r.confusableWith ?? [],
  built: r.built,
});

/** The everyday items and tools of the library (the catalog's `items`). */
export const HOUSEHOLD_ITEMS: readonly HouseholdItem[] = (catalog.items as unknown as CatalogRow[]).map(slim);
/** The chunky toy tool that stands in for tool jobs in the youngest bands: a picture and a shape, never a wrong answer and never matched by a word. */
export const HOUSEHOLD_SUPPORT: readonly HouseholdItem[] = (catalog.support as unknown as CatalogRow[]).map(slim);

const dropCache = new Map<string, GarageDrop | null>();

/** The household drop for a weekend (null on a Build Day), built once per weekend. Pass it to `garageStatus` as `householdDrop`. */
export function householdDropForWeekend(weekendKey: string): GarageDrop | null {
  if (!dropCache.has(weekendKey)) dropCache.set(weekendKey, householdDropFor(weekendKey, HOUSEHOLD_ITEMS));
  return dropCache.get(weekendKey) ?? null;
}

/** One item's pictures, in a 100 x 100 box as SVG path data drawn with the even-odd rule (see pictures.json). */
export interface HouseholdPicture {
  /** The whole outline from the front: the picture the grown-up's confirm shows. */
  front: string;
  /** The outline from a three-quarter view: the picture the shape game shows. */
  threeQuarter: string;
  /** Each colour zone's outline from the front, back to front, with its colour: the coloured picture. */
  zones: { zone: string; hex: string; d: string }[];
}
export type HouseholdPictures = Record<string, HouseholdPicture>;

let picturesPromise: Promise<HouseholdPictures> | null = null;

/** Load the pictures (once). Bundled into its own chunk, so it works offline and costs nothing until the Garage sheet opens. */
export function loadHouseholdPictures(): Promise<HouseholdPictures> {
  if (!picturesPromise) {
    picturesPromise = import("../../public/kip/household/pictures.json").then((m) => (m as unknown as { default: { items: HouseholdPictures } }).default.items);
  }
  return picturesPromise;
}
