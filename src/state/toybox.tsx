import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Toy } from "../../shared/toy";

const STORAGE_KEY = "toyforge:toybox:v1";

interface ToyboxState {
  toys: Toy[];
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
  const [toys, setToys] = useState<Toy[]>(loadToys);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => loadToys()[0]?.id,
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toys));
    } catch {
      // Storage full or unavailable: toybox just won't persist.
    }
  }, [toys]);

  const value = useMemo<ToyboxState>(
    () => ({
      toys,
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
