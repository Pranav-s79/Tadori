import { useCallback, useMemo, useRef } from "react";
import {
  CONFIDENCES,
  NODE_KINDS,
  ORIGINS,
  RELATIONS,
  RESOLUTIONS,
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
  switch (status) {
    case "idle":
      return "Type to search the graph by name, signature, or path.";
    case "loading":
      return "Searching…";
    case "empty":
      return "No matches. Try a different term or broaden your query.";
    case "ambiguous_adjacent":
      return `Multiple exact matches — refine your query to narrow further. Showing ${shown} of ${total ?? shown} results.`;
    case "ok":
      return `Showing ${shown} of ${total ?? shown} results.`;
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
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = store.results?.rows ?? [];
  const total = store.results?.total ?? null;

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

  const onInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Escape clears the query (returning focus to the graph stage is 08-02's
      // concern; here we clear and keep focus in the box per the reachable
      // fallback — blueprint §19).
      if (event.key === "Escape") {
        event.preventDefault();
        store.setQuery("");
      }
    },
    [store]
  );

  return (
    <section className="search-panel" aria-label="Search graph">
      <input
        ref={inputRef}
        type="search"
        role="searchbox"
        aria-label="Search graph"
        className="search-input"
        value={store.query}
        placeholder="Search graph…"
        onChange={(event) => store.setQuery(event.target.value)}
        onKeyDown={onInputKeyDown}
      />

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
      </div>

      <div role="status" aria-live="polite" className="search-status">
        {message}
      </div>

      {store.status === "error" && (
        <button type="button" className="search-retry" onClick={() => store.setQuery(store.query)}>
          Retry search
        </button>
      )}

      {rows.length > 0 && <ResultList rows={rows} onSelect={store.selectResult} />}
    </section>
  );
}
