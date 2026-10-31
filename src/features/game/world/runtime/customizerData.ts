// Pure customizer-snapshot builders for the native bridge (5A Unit 1 slice C).
//
// Each builder mirrors one legacy #sheet template in runtime/world.ts and
// returns the same ids, labels, selected/locked flags, and forge rows that
// engine.ts scraped from the hidden sheet DOM. Pure functions of explicit
// state, unit testable; world.ts stamps the result at render time. TEMP
// MIRROR: Unit 3 deleted the legacy HTML; these builders are the source
// deletes them, then these builders become the only source.

export type PaintZoneId = "c1" | "c2" | "skin";

export interface CuChoice {
  id: string;
  label: string;
  selected: boolean;
}

export interface CuOption extends CuChoice {
  detail: string;
  locked: boolean;
  lockLabel: string;
  statColor?: string;
}

export interface CuPaint {
  color: string;
  selected: boolean;
}

export interface CuForgeRow {
  key: string;
  name: string;
  desc: string;
  cost: number;
  hasBlueprint: boolean;
  owned: number;
  canForge: boolean;
  onPrintList: boolean;
}

export interface CuSnapshot {
  open: boolean;
  forge: boolean;
  toyType: string;
  types: CuChoice[];
  slots: CuChoice[];
  options: CuOption[];
  paintZones: (CuChoice & { id: PaintZoneId })[];
  paints: CuPaint[];
  moves: string;
  checkText: string;
  checkOk: boolean | null;
  scrap: number;
  forgeItems: {
    id: string | null;
    label: string;
    description: string;
    owned: number | null;
    locked: boolean;
    canForge: boolean;
    forgeLabel: string;
    printLabel: string;
    onPrintList: boolean;
  }[];
}

export interface CuOptionRow {
  optId: string;
  name: string;
  detail: string;
  statColor: string;
  locked: boolean;
  lockLabel: string;
  selected: boolean;
}

export function customizerData(args: {
  forge: boolean;
  toyType: string;
  scrap: number;
  types: CuChoice[];
  slots: CuChoice[];
  options: CuOptionRow[];
  skinZone: boolean;
  zone: PaintZoneId;
  paints: string[];
  paintSelected: string;
  movesText: string;
  forgeRows: CuForgeRow[] | null;
}): CuSnapshot {
  const paintZones: (CuChoice & { id: PaintZoneId })[] = [
    { id: "c1", label: "Main", selected: args.zone === "c1" },
    { id: "c2", label: "Accent", selected: args.zone === "c2" },
  ];
  if (args.skinZone) {
    paintZones.push({ id: "skin", label: "Skin", selected: args.zone === "skin" });
  }
  return {
    open: true,
    forge: args.forge,
    toyType: args.toyType,
    types: args.types,
    slots: args.slots,
    options: args.options.map((o) => ({
      id: o.optId,
      label: o.name,
      detail: o.detail,
      selected: o.selected,
      locked: o.locked,
      lockLabel: o.lockLabel,
      statColor: o.statColor,
    })),
    paintZones,
    paints: args.paints.map((color) => ({ color, selected: color === args.paintSelected })),
    moves: args.movesText,
    checkText: "Ready to 3D print",
    checkOk: true,
    scrap: args.scrap,
    forgeItems: (args.forgeRows ?? []).map((row) => ({
      id: row.hasBlueprint ? row.key : null,
      label: row.hasBlueprint ? row.name : "Blueprint not found yet",
      description: row.hasBlueprint ? row.desc : "Solve missions to find more blueprints.",
      owned: row.hasBlueprint ? row.owned : null,
      locked: !row.hasBlueprint,
      canForge: row.hasBlueprint && row.canForge,
      forgeLabel: row.hasBlueprint ? `Forge (${row.cost} scrap)` : "",
      printLabel: row.hasBlueprint ? (row.onPrintList ? "On print list" : "Print it for real") : "",
      onPrintList: row.hasBlueprint && row.onPrintList,
    })),
  };
}
