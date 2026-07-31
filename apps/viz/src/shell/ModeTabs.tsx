import { useRef, type KeyboardEvent, type ReactElement } from "react";

export type WorkspaceMode =
  | "overview"
  | "atlas"
  | "interview"
  | "story"
  | "changes"
  | "table";

interface ModeDefinition {
  id: WorkspaceMode;
  label: string;
  description: string;
}

export const WORKSPACE_MODES: readonly ModeDefinition[] = [
  { id: "overview", label: "Overview", description: "Understand what this repository is" },
  { id: "atlas", label: "Atlas", description: "Explore the repository map" },
  { id: "interview", label: "Interview", description: "Prepare to discuss this codebase" },
  { id: "story", label: "Story", description: "Trace static behavior" },
  { id: "changes", label: "Changes", description: "Review repository changes" },
  { id: "table", label: "Table", description: "Use the structured graph view" }
];

interface ModeTabsProps {
  active: WorkspaceMode;
  onChange(mode: WorkspaceMode): void;
}

/** Workspace modes following the ARIA tabs keyboard pattern. */
export function ModeTabs({ active, onChange }: ModeTabsProps): ReactElement {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function activate(index: number): void {
    const mode = WORKSPACE_MODES[index];
    if (mode === undefined) return;
    onChange(mode.id);
    buttonRefs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % WORKSPACE_MODES.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + WORKSPACE_MODES.length) % WORKSPACE_MODES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = WORKSPACE_MODES.length - 1;
    if (next !== null) {
      event.preventDefault();
      activate(next);
    }
  }

  return (
    <div className="mode-tabs" role="tablist" aria-label="Repository views">
      {WORKSPACE_MODES.map((mode, index) => (
        <button
          key={mode.id}
          ref={(element) => { buttonRefs.current[index] = element; }}
          type="button"
          id={`mode-tab-${mode.id}`}
          role="tab"
          aria-selected={active === mode.id}
          aria-controls="workspace-mode-panel"
          tabIndex={active === mode.id ? 0 : -1}
          title={mode.description}
          onClick={() => onChange(mode.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
