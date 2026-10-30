import type { ReactNode } from "react";

export type TabId = "toybox" | "build" | "packs" | "play";

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  {
    id: "toybox",
    label: "Toybox",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect
          x="4"
          y="9.5"
          width="16"
          height="10"
          rx="2.5"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M7.5 9.5V7a1.5 1.5 0 0 1 1.5-1.5h1.5A1.5 1.5 0 0 1 12 7v2.5M12 9.5V7a1.5 1.5 0 0 1 1.5-1.5H15A1.5 1.5 0 0 1 16.5 7v2.5"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    ),
  },
  {
    id: "build",
    label: "Build",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect
          x="4.5"
          y="10"
          width="15"
          height="9"
          rx="2"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M8 10V7.5a1.5 1.5 0 0 1 3 0V10M13 10V7.5a1.5 1.5 0 0 1 3 0V10"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    ),
  },
  {
    id: "packs",
    label: "Packs",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect
          x="5.5"
          y="3.5"
          width="13"
          height="17"
          rx="2.5"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path d="M5.5 8h13" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2 2" />
        <path
          d="M12 10.2l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4L12 10.2z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: "play",
    label: "Play",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M8 5.8v12.4c0 .8.9 1.3 1.6.9l10.2-6.2a1 1 0 0 0 0-1.8L9.6 4.9C8.9 4.5 8 5 8 5.8Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
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
          className={
            t.id === tab
              ? `tab tab-active tab-${t.id}`
              : `tab tab-${t.id}`
          }
          aria-current={t.id === tab ? "page" : undefined}
          onClick={() => onTab(t.id)}
        >
          <span className="tab-icon" aria-hidden="true">
            {t.icon}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
