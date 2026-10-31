// Pure create-snapshot builder for the native bridge (5A Unit 1 slice R).
//
// Mirrors the legacy #cr template in runtime/world.ts: card rows, undo and
// mic availability, and the transient say/input state. world.ts holds the
// say/input strings in closure vars set at the same sites that wrote the
// hidden DOM. TEMP MIRROR: hidden #cr DOM stays until Unit 3 deletes it.

export interface CrCard {
  title: string;
  text: string;
}

export interface CrSnapshot {
  open: boolean;
  busy: boolean;
  say: string;
  inputValue: string;
  chips: string[];
  cards: CrCard[];
  canUndo: boolean;
  codeVisible: boolean;
  micAvailable: boolean;
  recipe: unknown;
}

export interface CrSpot {
  name: string;
  hide: string;
  x: number;
}

export function createData(args: {
  busy: boolean;
  say: string;
  inputValue: string;
  chips: string[];
  themeName: string | null;
  spots: CrSpot[];
  scenery: string[];
  tip: boolean;
  canUndo: boolean;
  codeVisible: boolean;
  micAvailable: boolean;
  recipe: unknown;
}): CrSnapshot {
  const cards: CrCard[] = [];
  if (args.themeName !== null) {
    cards.push({ title: "Place", text: args.themeName });
    const ordered = args.spots.slice().sort((a, b) => a.x - b.x);
    ordered.forEach((spot, i) => {
      cards.push({
        title: `Hidden part ${i + 1}`,
        text: `${spot.name} in the ${spot.hide} at step ${spot.x}`,
      });
    });
    if (args.scenery.length > 0) {
      cards.push({ title: "Scenery", text: args.scenery.join(", ") });
    }
    if (args.tip) {
      cards.push({
        title: "Tip",
        text: "Ask for a cave, a tower, or a junk machine to hide parts in.",
      });
    }
  }
  return {
    open: true,
    busy: args.busy,
    say: args.say,
    inputValue: args.inputValue,
    chips: args.chips,
    cards,
    canUndo: args.canUndo,
    codeVisible: args.codeVisible,
    micAvailable: args.micAvailable,
    recipe: args.recipe,
  };
}
