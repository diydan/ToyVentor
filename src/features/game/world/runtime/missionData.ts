// Pure mission-panel data builders for the native bridge (5A Unit 1).
//
// Each builder mirrors one legacy panel template in runtime/world.ts and
// returns the same labels, disabled/primary/active/danger flags, datasets,
// groups, lines, and chips that engine.ts scraped from the hidden #mp DOM.
// The builders are pure functions of explicit state so they are unit
// testable; world.ts calls them at render time and stamps the result for
// engine.ts. TEMP MIRROR: the legacy HTML templates stay byte-identical
// until Unit 3 deletes them, then these builders become the only source.

export interface MpCtrl {
  label: string;
  disabled: boolean;
  primary: boolean;
  active: boolean;
  danger: boolean;
  dataset: Record<string, string>;
  /** Classic slots only: "Slot name · status". */
  group?: string;
  /** Pattern color keys only: swatch border color. */
  borderColor?: string;
}

export interface MpChip {
  text: string;
  question: boolean;
  background?: string;
}

export interface MpPanelData {
  title: string;
  goal: string;
  lines: string[];
  chips: MpChip[];
  ctrls: MpCtrl[];
  actionLabel: string;
  forgeAvailable: boolean;
  binText: string;
}

interface Chrome {
  title: string;
  goal: string;
  actionLabel: string;
  binText: string;
  forgeAvailable: boolean;
}

const ctrl = (
  label: string,
  dataset: Record<string, string>,
  opts: Partial<Pick<MpCtrl, "disabled" | "primary" | "active" | "danger" | "group" | "borderColor">> = {},
): MpCtrl => ({
  label,
  disabled: opts.disabled ?? false,
  primary: opts.primary ?? false,
  active: opts.active ?? false,
  danger: opts.danger ?? false,
  dataset,
  ...(opts.group !== undefined ? { group: opts.group } : {}),
  ...(opts.borderColor !== undefined ? { borderColor: opts.borderColor } : {}),
});

const withChrome = (
  chrome: Chrome,
  partial: Pick<MpPanelData, "lines" | "chips" | "ctrls">,
): MpPanelData => ({ ...chrome, ...partial });

export function replayData(chrome: Chrome): MpPanelData {
  return withChrome(chrome, { lines: [], chips: [], ctrls: [] });
}

export interface ClassicSlot {
  id: string;
  name: string;
  accept: string[];
}

export function classicData(
  chrome: Chrome,
  slots: ClassicSlot[],
  filled: Record<string, string | undefined>,
  bin: Record<string, number>,
  free: boolean,
  toolName: (id: string) => string,
): MpPanelData {
  const ctrls: MpCtrl[] = [];
  for (const slot of slots) {
    const cur = filled[slot.id];
    const group = `${slot.name} · ${cur ? toolName(cur) : "empty"}`;
    if (cur) {
      ctrls.push(ctrl("Take out", { out: slot.id }, { group }));
    } else {
      for (const key of slot.accept) {
        const n = free ? 9 : (bin[key] ?? 0);
        ctrls.push(
          ctrl(`${toolName(key)}${free ? "" : ` (${n})`}`, { use: `${slot.id}:${key}` }, { group, primary: n > 0, disabled: n <= 0 }),
        );
      }
    }
  }
  return withChrome(chrome, { lines: [], chips: [], ctrls });
}

export function measureData(chrome: Chrome, list: number[], gap: number): MpPanelData {
  const sum = list.reduce((a, b) => a + b, 0);
  const stat = `${list.length ? `${list.join(" + ")} = ${sum}` : "0"} of ${gap}${sum === gap ? "  Just right!" : ""}`;
  return withChrome(chrome, {
    lines: [stat],
    chips: [],
    ctrls: [
      ctrl("Add 2", { a: "2" }, { primary: true }),
      ctrl("Add 3", { a: "3" }, { primary: true }),
      ctrl("Add 4", { a: "4" }, { primary: true }),
      ctrl("Take one off", { a: "0" }),
    ],
  });
}

export function balanceData(
  chrome: Chrome,
  n1: number,
  n2: number,
  left: number,
  right: number,
): MpPanelData {
  const level = left === right;
  return withChrome(chrome, {
    lines: [
      `Left: ${left / 2} blocks far out = ${left}`,
      `Right: ${n1} near + ${n2} far x 2 = ${right}${level ? "  Level!" : ""}`,
    ],
    chips: [],
    ctrls: [
      ctrl("Add near", { b: "n1:1" }, { primary: true }),
      ctrl("Add far", { b: "n2:1" }, { primary: true }),
      ctrl("Take near", { b: "n1:-1" }),
      ctrl("Take far", { b: "n2:-1" }),
    ],
  });
}

export function logicData(
  chrome: Chrome,
  doorIndex: number,
  doorCount: number,
  gateName: string,
  gateTag: string,
  isOpen: boolean,
  hasA: boolean,
  aOn: boolean,
  hasB: boolean,
  bOn: boolean,
): MpPanelData {
  const ctrls = [
    ctrl(aOn ? "Take crate off A" : "Put crate on A", { p: "A" }, { primary: !aOn }),
  ];
  if (hasB) {
    ctrls.push(ctrl(bOn ? "Take crate off B" : "Put crate on B", { p: "B" }, { primary: !bOn }));
  }
  void hasA;
  return withChrome(chrome, {
    lines: [
      `Door ${doorIndex + 1} of ${doorCount}: ${gateName} gate, ${gateTag}.`,
      `Door is ${isOpen ? "open" : "shut"}`,
    ],
    chips: [],
    ctrls,
  });
}

export function raftData(
  chrome: Chrome,
  up: number,
  down: number,
  need: number,
  names: Record<string, string>,
  full: boolean,
): MpPanelData {
  const net = up - down;
  const ok = net >= need;
  return withChrome(chrome, {
    lines: [
      `Floats up: ${up}`,
      `Weighs down: ${down} (your toy is 4)`,
      `${ok ? "It will float" : "It will sink"}${need > 0 ? ` (need +${need})` : ""}`,
    ],
    chips: [],
    ctrls: [
      ...Object.keys(names).map((key) =>
        ctrl(names[key]!, { r: key }, { primary: !full, disabled: full }),
      ),
      ctrl("Take one off", { r: "off" }),
    ],
  });
}

export function leverData(
  chrome: Chrome,
  basketIndex: number,
  toySide: number,
  starSide: number,
): MpPanelData {
  const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);
  const g = gcd(toySide, starSide);
  return withChrome(chrome, {
    lines: [
      `Basket ${basketIndex + 1} of 2`,
      `Toy side ${toySide} : star side ${starSide} (${toySide / g} : ${starSide / g})`,
    ],
    chips: [],
    ctrls: [
      ctrl("Triangle left", { l: "-1" }, { primary: true }),
      ctrl("Triangle right", { l: "1" }, { primary: true }),
    ],
  });
}

export interface CircuitCell {
  key: string;
  label: string;
  lit: boolean;
  locked: boolean;
}

export function circuitData(chrome: Chrome, status: string, cells: CircuitCell[]): MpPanelData {
  return withChrome(chrome, {
    lines: [status],
    chips: [],
    ctrls: cells.map((cell) =>
      ctrl(cell.label, { c: cell.key }, { active: cell.lit, disabled: cell.locked }),
    ),
  });
}

export interface CodeSlot {
  label: string;
  filled: boolean;
  bad: boolean;
}

export function codeData(
  chrome: Chrome,
  slots: CodeSlot[],
  keys: { id: string; label: string }[],
  programFull: boolean,
): MpPanelData {
  return withChrome(chrome, {
    lines: [],
    chips: [],
    ctrls: [
      ...slots.map((slot, i) =>
        ctrl(slot.filled ? slot.label : String(i + 1), { q: String(i) }, { disabled: !slot.filled, danger: slot.bad }),
      ),
      ...keys.map((key) => ctrl(key.label, { k: key.id }, { primary: true, disabled: programFull })),
    ],
  });
}

export interface PatternChip {
  text: string;
  background: string;
}

export function patternData(
  chrome: Chrome,
  round: number,
  rounds: number,
  seq: PatternChip[],
  answered: (PatternChip | null)[],
  keys: { id: string; label: string; border: string }[],
): MpPanelData {
  return withChrome(chrome, {
    lines: [`Pattern ${round + 1} of ${rounds}`],
    chips: [
      ...seq.map((chip) => ({ text: chip.text, question: false, background: chip.background })),
      ...answered.map((chip) =>
        chip
          ? { text: chip.text, question: false, background: chip.background }
          : { text: "?", question: true },
      ),
    ],
    ctrls: keys.map((key) =>
      ctrl(key.label, { pb: key.id }, { borderColor: key.border }),
    ),
  });
}

/** Tiered soap-drop window for the clean-up mix step: [min, max]. */
export function soapWindow(tier: number): [number, number] {
  return tier === 3 ? [3, 3] : tier === 2 ? [2, 2] : [2, 3];
}

export interface CleanTool {
  id: string;
  label: string;
}

export interface CleanState {
  stage: number;
  tool: string | null;
  soap: number;
  soapMixed: boolean;
  cleaned: Record<string, boolean>;
  fixed: Record<string, boolean>;
  holeReady: boolean;
  plates: number[];
  holdingName: string | null;
  tier: number;
  toolNames: Record<string, string>;
  messLabel: (id: string) => string;
}

export function cleanData(chrome: Chrome, s: CleanState): MpPanelData {
  if (s.stage === 0) {
    const lines = ["Step 1 of 3: clean up. Pick a tool, then tap a mess."];
    const ctrls = [
      ctrl(s.toolNames.vacuum!, { t: "vacuum" }, { primary: s.tool === "vacuum" }),
      ctrl(s.toolNames.mop!, { t: "mop" }, { primary: s.tool === "mop" }),
      ctrl(s.toolNames.sponge!, { t: "sponge" }, { primary: s.tool === "sponge" }),
    ];
    if (s.tool === "sponge" && !s.soapMixed) {
      const [lo, hi] = soapWindow(s.tier);
      lines.push(
        `Mix the soapy water first. Soap drops: ${s.soap}${s.soap < lo ? " (not enough)" : s.soap > hi ? " (too much: slippery suds!)" : " (just right)"}`,
      );
      ctrls.push(
        ctrl("Add soap", { s: "add" }, { primary: true }),
        ctrl("Pour out", { s: "pour" }),
        ctrl("Ready", { s: "ready" }, { primary: s.soap >= lo && s.soap <= hi }),
      );
    }
    for (const id of ["crumbs", "puddle", "jam"]) {
      ctrls.push(
        s.cleaned[id]
          ? ctrl(`${s.messLabel(id)} clean`, {}, { disabled: true })
          : ctrl(`Clean the ${id === "jam" ? "sticky jam" : id}`, { m: id }, { primary: true }),
      );
    }
    return withChrome(chrome, { lines, chips: [], ctrls });
  }
  if (s.stage === 1) {
    return withChrome(chrome, {
      lines: [
        `Step 2 of 3: fix the wobbly table. Pick a tool on your tool belt, then tap what it fits. Holding: ${s.holdingName ?? "nothing"}`,
      ],
      chips: [],
      ctrls: ["nail", "bolt", "screw"].map((id) =>
        s.fixed[id]
          ? ctrl(`${id} fixed`, {}, { disabled: true })
          : ctrl(`Fix the ${id}${id === "screw" && s.holeReady ? " (hole ready)" : ""}`, { f: id }, { primary: true }),
      ),
    });
  }
  const left = 6 - s.plates.reduce((a, b) => a + b, 0);
  const ctrls: MpCtrl[] = [];
  s.plates.forEach((_, i) => {
    ctrls.push(
      ctrl(`Plate ${i + 1} +`, { c: `${i}:1` }, { primary: true }),
      ctrl(`Plate ${i + 1} -`, { c: `${i}:-1` }),
    );
  });
  return withChrome(chrome, {
    lines: [`Step 3 of 3: share 6 cookies fairly. Plates: ${s.plates.join(", ")}. Left: ${left}`],
    chips: [],
    ctrls,
  });
}
