/**
 * The colours a child can give a part they made (docs/specs/forge-ai-spec.md, "Naming"): one of the app's colour words, with the hex the part is drawn in.
 * The word is what /api/voice says in front of the name ("purple wizard hat", "cuchara roja"), built by code in each language and never written by a model.
 * `colorful` (the twelfth word) is left out: it is not one colour. Pure: no DOM, no network, no clock.
 *
 * Every hex here maps back to its own word through `colorKeyFromHex` in src/lib/propNames.ts (tests/forge-colors.test.ts checks), so what a child sees and what the
 * voice says always agree.
 */
export const FORGE_COLORS = [
  { key: "red", hex: "#e53935" },
  { key: "orange", hex: "#fb8c00" },
  { key: "yellow", hex: "#fdd835" },
  { key: "green", hex: "#43a047" },
  { key: "blue", hex: "#1e88e5" },
  { key: "purple", hex: "#7c4dff" },
  { key: "pink", hex: "#f48fb1" },
  { key: "brown", hex: "#8b5a2b" },
  { key: "white", hex: "#f5f5f5" },
  { key: "black", hex: "#212121" },
  { key: "gray", hex: "#9e9e9e" },
] as const;

export type ForgeColorKey = (typeof FORGE_COLORS)[number]["key"];
/** What a part is drawn in until the child picks one (the custom-part purple the bench has always used). */
export const DEFAULT_FORGE_COLOR: ForgeColorKey = "purple";

export const forgeColorHex = (key: string): string => FORGE_COLORS.find((c) => c.key === key)?.hex ?? FORGE_COLORS.find((c) => c.key === DEFAULT_FORGE_COLOR)!.hex;
export const isForgeColorKey = (key: unknown): key is ForgeColorKey => FORGE_COLORS.some((c) => c.key === key);
