export type TabId = "factory" | "toybox" | "packs" | "market" | "play";

const TABS: { id: TabId; label: string }[] = [
  { id: "factory", label: "Factory" },
  { id: "toybox", label: "Toybox" },
  { id: "packs", label: "Packs" },
  { id: "market", label: "Market" },
  { id: "play", label: "Play" },
];

export function BottomBar({
  tab,
  onTab,
}: {
  tab: TabId;
  onTab: (tab: TabId) => void;
}) {
  return (
    <nav className="bottom-bar" aria-label="Main">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={t.id === tab ? "tab tab-active" : "tab"}
          aria-current={t.id === tab ? "page" : undefined}
          onClick={() => onTab(t.id)}
        >
          <span className="tab-orb" aria-hidden="true" />
          {t.label}
        </button>
      ))}
    </nav>
  );
}
