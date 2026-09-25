import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CONFIDENCES,
  CAPABILITIES,
  DERIVATIONS,
  NODE_KINDS,
  ORIGINS,
  RELATIONS,
  RESOLUTIONS,
  activeFilterCount,
  type SearchFilters
} from "./filterState.ts";
import { ResultList } from "./ResultList.tsx";
import { useSearchStore, type SearchStoreCallbacks } from "./useSearchStore.ts";

/** Distinct, non-blank copy per state (blueprint §5/§13 — never a blank list
 * with no explanation). Kept as one source of truth so the aria-live region
 * and the visible banner never drift apart. */
function statusText(
  status: string,
  total: number | null,
  shown: number
): string {
  const count = `${shown} of ${total ?? shown} ${(total ?? shown) === 1 ? "result" : "results"}`;
  switch (status) {
    case "idle":
      return "Type to search the graph by name, signature, or path.";
    case "loading":
      return "Searching…";
    case "empty":
      return "No matches. Try a different term or broaden your query.";
    case "ambiguous_adjacent":
      return `Multiple exact matches — refine your query to narrow further. Showing ${count}.`;
    case "ok":
      return `Showing ${count}.`;
    case "error":
      return "Search failed. Check the connection and retry.";
    default:
      return "";
  }
}

/** One multi-select checkbox group over a frozen vocabulary. Toggling never
 * issues a network fetch — it only updates view state (blueprint §14). */
function FilterGroup<T extends string>(props: {
  label: string;
  options: readonly T[];
  selected: T[];
  onToggle: (value: T) => void;
}): React.ReactElement {
  return (
    <div role="group" aria-label={props.label} className="search-filter-group">
      <span className="search-filter-legend">{props.label}</span>
      {props.options.map((option) => {
        const checked = props.selected.includes(option);
        return (
          <label key={option} className="search-filter-option">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => props.onToggle(option)}
            />
            {option}
          </label>
        );
      })}
    </div>
  );
}

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function SearchPanel(props: SearchStoreCallbacks = {}): React.ReactElement {
  const store = useSearchStore(props);
  const rootRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The results and the filters open under the field on demand, as a dropdown:
  // on click, on typing, or on ArrowDown.
  const [open, setOpen] = useState(false);

  const rows = store.results?.rows ?? [];
  const total = store.results?.total ?? null;
  const filterCount = activeFilterCount(store.filters);

  const message = useMemo(
    () => statusText(store.status, total, rows.length),
    [store.status, total, rows.length]
  );

  const patch = useCallback(
    (next: Partial<SearchFilters>) => {
      store.setFilters({ ...store.filters, ...next });
    },
    [store]
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node) !== true) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Focus returns to the field before the inspector opens, so the inspector
  // records the field as its opener and hands focus back to it on close.
  const select = useCallback(
    (entityKey: string) => {
      inputRef.current?.focus();
      setOpen(false);
      store.selectResult(entityKey);
    },
    [store]
  );

  const onInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "ArrowDown") return;
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      rootRef.current?.querySelector<HTMLElement>('[role="option"][tabindex="0"]')?.focus();
    },
    [open]
  );

  // Escape closes the dropdown and returns to the field; with the dropdown
  // already closed, Escape in the field clears the query. It is left to bubble
  // so a narrow-screen search panel around this one closes too.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Escape") return;
      if (open) {
        setOpen(false);
        inputRef.current?.focus();
      } else if (event.target === inputRef.current) {
        event.preventDefault();
        store.setQuery("");
      }
    },
    [open, store]
  );

  const onBlur = useCallback((event: React.FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !event.currentTarget.contains(next)) setOpen(false);
  }, []);

  return (
    <section ref={rootRef} className="search-panel" aria-label="Search graph" onKeyDown={onKeyDown} onBlur={onBlur}>
      <div className="search-field">
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          aria-label="Search graph"
          aria-controls="search-dropdown"
          className="search-input"
          value={store.query}
          placeholder="Search graph…"
          onClick={() => setOpen(true)}
          onChange={(event) => {
            store.setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onInputKeyDown}
        />
        {/* Filters also dim the map, so a filtered view says so while the
            dropdown is closed: a constrained view never looks unconstrained. */}
        {filterCount > 0 && (
          <span className="search-filter-flag">{`${String(filterCount)} ${filterCount === 1 ? "filter" : "filters"} on`}</span>
        )}
      </div>

      <div id="search-dropdown" className="search-dropdown" data-open={open}>
        <div role="status" aria-live="polite" className="search-status">
          {message}
        </div>

        {/* Collapsed by default, so the results sit directly under the field.
            The count in the summary keeps a collapsed set honest. */}
        <details className="search-filters-disclosure" role="group" aria-label="Filters">
          <summary>
            Filters
            <span className="search-filters-count">{filterCount}</span>
          </summary>
          <div className="search-filters">
          <FilterGroup
            label="Filter by kind"
            options={NODE_KINDS}
            selected={store.filters.kinds}
            onToggle={(v) => patch({ kinds: toggleValue(store.filters.kinds, v) })}
          />
          <FilterGroup
            label="Filter by relation"
            options={RELATIONS}
            selected={store.filters.relations}
            onToggle={(v) => patch({ relations: toggleValue(store.filters.relations, v) })}
          />
          <FilterGroup
            label="Filter by origin"
            options={ORIGINS}
            selected={store.filters.origins}
            onToggle={(v) => patch({ origins: toggleValue(store.filters.origins, v) })}
          />
          <FilterGroup
            label="Filter by confidence"
            options={CONFIDENCES}
            selected={store.filters.confidences}
            onToggle={(v) => patch({ confidences: toggleValue(store.filters.confidences, v) })}
          />
          <FilterGroup
            label="Filter by resolution"
            options={RESOLUTIONS}
            selected={store.filters.resolutions}
            onToggle={(v) => patch({ resolutions: toggleValue(store.filters.resolutions, v) })}
          />
          <FilterGroup
            label="Filter by language"
            options={props.languageOptions ?? []}
            selected={store.filters.languages}
            onToggle={(v) => patch({ languages: toggleValue(store.filters.languages, v) })}
          />
          <FilterGroup
            label="Filter by capability"
            options={CAPABILITIES}
            selected={store.filters.capabilities}
            onToggle={(v) => patch({ capabilities: toggleValue(store.filters.capabilities, v) })}
          />
          <FilterGroup
            label="Filter by derivation"
            options={DERIVATIONS}
            selected={store.filters.derivations}
            onToggle={(v) => patch({ derivations: toggleValue(store.filters.derivations, v) })}
          />
          </div>
        </details>

        {store.status === "error" && (
          <button type="button" className="search-retry" onClick={() => store.setQuery(store.query)}>
            Retry search
          </button>
        )}

        {rows.length > 0 && <ResultList rows={rows} onSelect={select} />}
      </div>
    </section>
  );
}
