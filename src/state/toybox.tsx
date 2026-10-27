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
  mergeToyboxToys,
  toyboxUploads,
  type Toy,
} from "../../shared/toy";
import { backupToys } from "../features/scan/scan";

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

function loadToys(): Toy[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Toy[]) : [];
  } catch {
    return [];
  }
}

export function ToyboxProvider({ children }: { children: ReactNode }) {
  const [toys, setToys] = useState<Toy[]>(() =>
    mergeToyboxToys(loadToys(), backupToys),
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => toys[0]?.id,
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toyboxUploads(toys)));
    } catch {
      // Storage full or unavailable: toybox just won't persist.
    }
  }, [toys]);

  const value = useMemo<ToyboxState>(
    () => ({
      toys,
      uploadedToys: toyboxUploads(toys),
      builtInToys: toys.filter(isBuiltInToy),
      selected: toys.find((t) => t.id === selectedId) ?? toys[0],
      addToy: (toy) => {
        setToys((prev) =>
          prev.some((t) => t.id === toy.id) ? prev : [...prev, toy],
        );
        setSelectedId(toy.id);
      },
      selectToy: setSelectedId,
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
