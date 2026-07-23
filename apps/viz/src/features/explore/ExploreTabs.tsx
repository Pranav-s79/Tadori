import { useState, type KeyboardEvent, type ReactElement } from "react";
import { DocumentsPanel } from "./DocumentsPanel.tsx";
import { LikelyTests } from "./LikelyTests.tsx";
import { PathFinder } from "./PathFinder.tsx";
import { RouteTable } from "./RouteTable.tsx";

interface ExploreTabsProps {
  onInspect?: (entityKey: string) => void;
  /** Open a route's behavior story (routes are the story trigger). */
  onShowStory?: (entityKey: string) => void;
}

type ExploreTab = "path" | "routes" | "tests" | "docs";

const TABS: { id: ExploreTab; label: string }[] = [
  { id: "path", label: "Path" },
  { id: "routes", label: "Routes" },
  { id: "tests", label: "Tests" },
  { id: "docs", label: "Docs" }
];

/**
 * The Explore panel: Path / Routes / Tests / Docs as MUTUALLY EXCLUSIVE tabs
 * (only the active view is mounted — never four panels at once, per the
 * no-dual-dashboard rule). Standard ARIA tabs keyboard pattern: arrows move
 * between tabs, each panel is labelled by its tab.
 */
export function ExploreTabs({ onInspect, onShowStory }: ExploreTabsProps): ReactElement {
  const [active, setActive] = useState<ExploreTab>("path");

  function onTabKeyDown(event: KeyboardEvent, index: number): void {
    if (
      event.key !== "ArrowRight" &&
      event.key !== "ArrowLeft" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowRight") {
      next = (index + 1) % TABS.length;
    } else if (event.key === "ArrowLeft") {
      next = (index - 1 + TABS.length) % TABS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else {
      next = TABS.length - 1;
    }
    setActive(TABS[next]!.id);
  }

  return (
    <div className="explore-tabs" aria-label="Explore">
      <div role="tablist" aria-label="Explore views">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`explore-tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`explore-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setActive(tab.id)}
            onKeyDown={(e) => onTabKeyDown(e, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`explore-panel-${active}`} aria-labelledby={`explore-tab-${active}`}>
        {active === "path" && <PathFinder onInspect={onInspect} />}
        {active === "routes" && <RouteTable onInspect={onInspect} onShowStory={onShowStory} />}
        {active === "tests" && <LikelyTests onInspect={onInspect} />}
        {active === "docs" && <DocumentsPanel onInspect={onInspect} />}
      </div>
    </div>
  );
}
