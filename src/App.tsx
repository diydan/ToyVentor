import { useEffect, useMemo, useRef, useState } from "react";
import { buildStats, type Placement } from "../shared/build";
import { buildSignature } from "../shared/reveal";
import { validateToy, type Toy } from "../shared/toy";
import {
  decodeToyContractFromHash,
  kipDemoUrl,
  toyContractFromBuild,
  type ToyContract,
} from "../shared/toycontract";
import { colorOf } from "./features/builder/engine/render";
import {
  GameCanvas,
  type InitialOverlay,
} from "./features/game/world/GameCanvas";
import { seedCar } from "./features/scan/scan";
import { loadBuild } from "./lib/builds";
import { partsById } from "./lib/catalog";
import { pullOwnership, pushOwnership } from "./lib/sync";
import { useToybox } from "./state/toybox";

function parseInitialOverlay(): InitialOverlay {
  try {
    const q = new URLSearchParams(window.location.search).get("tab");
    if (q === "packs" || q === "pack") return "pack";
    if (q === "toybox" || q === "factory") return "toy";
    if (q === "scan") return "scan";
    if (q === "build" || q === "market" || q === "augment") return "build";
    if (q === "reveal") return "reveal";
    if (q === "parent" || q === "grownups") return "parent";
  } catch {
    /* ignore */
  }
  return null;
}

function parseHashToyContract(): ToyContract | null {
  return decodeToyContractFromHash(window.location.hash);
}

export default function App() {
  const { toys, selected, addToy } = useToybox();
  const syncedRef = useRef(false);
  const toy = selected ?? toys[0] ?? seedCar;

  const [initialOverlay] = useState<InitialOverlay>(parseInitialOverlay);
  const [sharedContract, setSharedContract] = useState<ToyContract | null>(
    parseHashToyContract,
  );
  const [placements, setPlacements] = useState<Placement[]>(() =>
    loadBuild(toy.id, partsById),
  );
  const [, setSkinVersion] = useState(0);

  // Sync placements from localStorage whenever the active toy switches.
  useEffect(() => {
    setPlacements(loadBuild(toy.id, partsById));
  }, [toy.id]);

  // Clear one-time shared hash override when the kid switches to another toy.
  const firstToyIdRef = useRef(toy.id);
  useEffect(() => {
    if (toy.id !== firstToyIdRef.current) {
      setSharedContract(null);
    }
  }, [toy.id]);

  const toyIds = useMemo(() => toys.map((t) => t.id), [toys]);

  // One ownership sync per load: pull server toys we do not have, push local ones.
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    void (async () => {
      const remote = await pullOwnership();
      if (!remote) return;
      const localIds = new Set(toys.map((t) => t.id));
      const remoteToyIds = new Set<string>();
      for (const record of remote) {
        if (record.type !== "toy") continue;
        remoteToyIds.add(record.id);
        if (!localIds.has(record.id) && validateToy(record.payload).length === 0)
          addToy(record.payload as Toy);
      }
      for (const localToy of toys) {
        if (!remoteToyIds.has(localToy.id))
          void pushOwnership({ type: "toy", id: localToy.id, payload: localToy });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePlacementsChange = (next: Placement[]) => {
    setSharedContract(null);
    setPlacements(next);
  };

  const totals = useMemo(
    () => buildStats(placements, partsById).statTotals,
    [placements],
  );

  const localContract = useMemo(
    () => toyContractFromBuild(toy, placements, partsById, colorOf),
    [toy, placements],
  );

  const contract = sharedContract ?? localContract;

  const leadPart = placements[0]
    ? partsById.get(placements[0].partId)
    : undefined;
  const toyColor =
    sharedContract?.col.c1 ||
    (leadPart ? colorOf(leadPart) : toy.id === "seed-kip" ? "#ffd24d" : "#52b7ff");

  const statEntries = Object.entries(totals).filter(([, v]) => (v ?? 0) > 0);
  const statSummary =
    statEntries.length > 0
      ? statEntries.map(([k, v]) => `${k} +${v}`).join(" · ")
      : undefined;

  return (
    <div className="app app-play">
      <main className="screen screen-play">
        <GameCanvas
          toy={toy}
          toyIds={toyIds}
          placements={placements}
          onPlacementsChange={handlePlacementsChange}
          onSkinChange={() => setSkinVersion((n) => n + 1)}
          contract={contract}
          toyName={sharedContract ? sharedContract.name : toy.name}
          toyColor={toyColor}
          statSummary={statSummary}
          themeSignature={
            placements.length > 0 ? buildSignature(placements) : undefined
          }
          kipUrl={
            (sharedContract ? sharedContract.type === "character" : toy.kind === "figure")
              ? kipDemoUrl(contract)
              : undefined
          }
          initialOverlay={initialOverlay}
        />
      </main>
    </div>
  );
}
