import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  isBuiltInToy,
  toyboxUploads,
  type Toy,
} from "../../shared/toy";
import { decodeToyContractFromHash } from "../../shared/toycontract";
import { seedFigure, seedKip } from "../features/scan/scan";
import { loadProgression } from "../lib/progression";
import {
  findVehicleAuditByIdOrAlias,
  resolvePhase4VehicleRoster,
} from "../lib/vehicleReadiness";
import {
  canonicalToyName,
  checkStarScoutGrandfatheredFromStorage,
  loadActiveToyId,
  mergePhase2Roster,
  normalizeSavedToyIdentity,
  saveActiveToyId,
} from "../lib/toyRoster";

const STORAGE_KEY = "toyforge:toybox:v1";

interface ToyboxState {
  toys: Toy[];
  uploadedToys: Toy[];
  builtInToys: Toy[];
  selected: Toy | undefined;
  addToy: (toy: Toy) => void;
  selectToy: (id: string) => void;
}

const ToyboxContext = createContext<ToyboxState | null>(null);

function loadSavedToys(): Toy[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Toy[]) : [];
  } catch {
    return [];
  }
}

function initialActiveToyId(savedToys: readonly Toy[]): string {
  try {
    const hashContract = decodeToyContractFromHash(window.location.hash);
    if (hashContract?.id) return hashContract.id;
  } catch {
    /* ignore */
  }
  const stored = loadActiveToyId();
  if (stored) return stored;
  // Legacy devices that scanned/saved a toy before active-toy persistence keep
  // their first upload active; fresh devices start on Kip (`seed-kip`).
  const firstUpload = savedToys.find((t) => !isBuiltInToy(t));
  return firstUpload?.id ?? seedKip.id;
}

export function ToyboxProvider({ children }: { children: ReactNode }) {
  const [initialBoot] = useState(() => {
    const saved = loadSavedToys();
    const activeId = initialActiveToyId(saved);
    const grandfathered = checkStarScoutGrandfatheredFromStorage(activeId, saved);
    const merged = mergePhase2Roster(saved, {
      activeToyId: activeId,
      savedToys: saved,
      hasSavedBuild: grandfathered,
    });
    // Re-materialize rank-unlocked Phase 4 vehicles so a stored active toy
    // (or earned unlock) survives reloads; uploads persist separately below.
    const { unlockedVehicles } = resolvePhase4VehicleRoster(loadProgression(), {
      activeToyId: activeId,
      savedToys: saved,
    });
    for (const vehicle of unlockedVehicles) {
      if (!merged.some((t) => t.id === vehicle.id)) merged.push(vehicle);
    }
    const resolvedSelectedId =
      merged.find((t) => t.id === activeId)?.id ?? merged[0]?.id ?? seedKip.id;
    return { merged, resolvedSelectedId };
  });

  const [toys, setToys] = useState<Toy[]>(initialBoot.merged);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialBoot.resolvedSelectedId,
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toyboxUploads(toys)));
    } catch {
      // Storage full or unavailable: toybox just won't persist.
    }
  }, [toys]);

  useEffect(() => {
    if (selectedId) {
      saveActiveToyId(selectedId);
    }
  }, [selectedId]);

  const value = useMemo<ToyboxState>(
    () => ({
      toys,
      uploadedToys: toyboxUploads(toys),
      builtInToys: toys
        .filter(isBuiltInToy)
        .map((toy) => ({ ...toy, name: canonicalToyName(toy) })),
      selected: toys.find((t) => t.id === selectedId) ?? toys[0],
      addToy: (rawToy) => {
        const toy = normalizeSavedToyIdentity(rawToy);
        setToys((prev) =>
          prev.some((t) => t.id === toy.id) ? prev : [...prev, toy],
        );
        setSelectedId(toy.id);
      },
      selectToy: (id) => {
        if (id === seedFigure.id) {
          setToys((prev) =>
            prev.some((t) => t.id === seedFigure.id) ? prev : [...prev, seedFigure],
          );
        } else {
          // Materialize rank-unlocked Phase 4 seeds on demand. Only
          // audit-ready entries resolve here, so unverified geometry can
          // never load; XP-gating itself is enforced by the sheet UI.
          const entry = findVehicleAuditByIdOrAlias(id);
          if (entry?.ready && entry.seedToy) {
            const seedToy = entry.seedToy;
            setToys((prev) =>
              prev.some((t) => t.id === seedToy.id)
                ? prev
                : [...prev, { ...seedToy }],
            );
          }
        }
        setSelectedId(id);
      },
    }),
    [toys, selectedId],
  );

  return <ToyboxContext.Provider value={value}>{children}</ToyboxContext.Provider>;
}

export function useToybox(): ToyboxState {
  const ctx = useContext(ToyboxContext);
  if (!ctx) throw new Error("useToybox must be used inside ToyboxProvider");
  return ctx;
}
