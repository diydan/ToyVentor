// Pure editor-snapshot builder for the native bridge (5A Unit 1 slice E).
//
// Mirrors the legacy #ed template in runtime/world.ts: tab labels (with the
// live Checks pass/total), inspector selects, palette rows, check rows, and
// the import/export dialog state. world.ts holds the input-mirror strings
// (name/theme/io/back-label) in closure vars set at the same sites that
// wrote the hidden DOM. TEMP MIRROR: hidden #ed DOM stays until Unit 3.

export interface EdTab {
  id: string;
  label: string;
  selected: boolean;
}

export interface EdPaletteItem {
  index: number;
  label: string;
  detail: string;
  selected: boolean;
  color?: string;
}

export interface EdControl {
  index: number;
  label: string;
  disabled: boolean;
  primary: boolean;
}

export interface EdSelectOption {
  value: string;
  label: string;
  selected: boolean;
  group?: string;
}

export interface EdSelect {
  index: number;
  label: string;
  value: string;
  options: EdSelectOption[];
}

export interface EdCheck {
  title: string;
  detail: string;
  ok: boolean;
}

export interface EdIo {
  open: boolean;
  title: string;
  text: string;
  readOnly: boolean;
  canCopy: boolean;
  canLoad: boolean;
}

export interface EdSnapshot {
  open: boolean;
  testing: boolean;
  mode: "editor" | "create";
  backLabel: string;
  name: string;
  theme: string;
  tab: string;
  tabs: EdTab[];
  canUndo: boolean;
  canRedo: boolean;
  selectedTitle: string;
  lines: string[];
  palette: EdPaletteItem[];
  controls: EdControl[];
  selects: EdSelect[];
  checks: EdCheck[];
  io: EdIo;
  recipe: unknown;
}

export interface EdInspectorSelect {
  label: string;
  value: string;
  groups: { label: string; options: { value: string; label: string; selected: boolean }[] }[];
}

const STATIC_CONTROLS: { label: string; primary: boolean }[] = [
  { label: "Move left", primary: false },
  { label: "Move right", primary: false },
  { label: "Delete", primary: false },
  { label: "Done", primary: true },
];

export function editorData(args: {
  testing: boolean;
  kid: boolean;
  backLabel: string;
  name: string;
  theme: string;
  tab: string;
  checkPass: number;
  checkTotal: number;
  canUndo: boolean;
  canRedo: boolean;
  sel: null | {
    title: string;
    mut: string;
    hide: EdInspectorSelect | null;
    part: EdInspectorSelect | null;
  };
  palette: { label: string; detail: string; selected: boolean; color?: string }[] | null;
  tabMut: string | null;
  checks: { title: string; detail: string; ok: boolean }[] | null;
  io: EdIo;
  recipe: unknown;
}): EdSnapshot {
  const tabs: EdTab[] = [
    { id: "spots", label: "Hiding spots", selected: args.tab === "spots" },
    { id: "props", label: "Scenery", selected: args.tab === "props" },
    {
      id: "checks",
      label: `Checks ${args.checkPass}/${args.checkTotal}`,
      selected: args.tab === "checks",
    },
  ];
  const controls: EdControl[] = args.sel
    ? STATIC_CONTROLS.map((c, index) => ({ ...c, index, disabled: false }))
    : [];
  const selects: EdSelect[] = [];
  if (args.sel?.hide) {
    selects.push({
      index: 0,
      label: args.sel.hide.label,
      value: args.sel.hide.value,
      options: args.sel.hide.groups.flatMap((group) =>
        group.options.map((option) => ({ ...option, group: group.label })),
      ),
    });
  }
  if (args.sel?.part) {
    selects.push({
      index: selects.length,
      label: args.sel.part.label,
      value: args.sel.part.value,
      options: args.sel.part.groups.flatMap((group) =>
        group.options.map((option) => ({ ...option, group: group.label })),
      ),
    });
  }
  return {
    open: true,
    testing: args.testing,
    mode: args.kid ? "create" : "editor",
    backLabel: args.backLabel,
    name: args.name,
    theme: args.theme,
    tab: args.tab,
    tabs,
    canUndo: args.canUndo,
    canRedo: args.canRedo,
    selectedTitle: args.sel?.title ?? "",
    lines: args.sel ? [args.sel.mut] : args.tabMut ? [args.tabMut] : [],
    palette: (args.palette ?? []).map((item, index) => ({ ...item, index })),
    controls,
    selects,
    checks: args.checks ?? [],
    io: args.io,
    recipe: args.recipe,
  };
}
