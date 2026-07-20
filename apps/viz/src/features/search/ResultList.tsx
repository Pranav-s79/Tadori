import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResultRow } from "./searchApi.ts";

export interface ResultListProps {
  rows: SearchResultRow[];
  onSelect: (entityKey: string) => void;
}

function fileLine(row: SearchResultRow): string | null {
  if (row.file === null) {
    return null;
  }
  return row.lineStart === null ? row.file : `${row.file}:${row.lineStart}`;
}

/** Accessible name per row: kind + qualified name (never display name alone),
 * so a screen-reader user can disambiguate two nodes with the same display
 * name (blueprint §19 screen-reader text). */
function rowLabel(row: SearchResultRow): string {
  const loc = fileLine(row);
  const base = `${row.kind}: ${row.qualifiedName}`;
  const parts = [base];
  if (loc !== null) {
    parts.push(loc);
  }
  if (row.exactMatch) {
    parts.push("exact match");
  }
  return parts.join(", ");
}

/**
 * Keyboard-navigable listbox (blueprint §19). Roving tabindex: the list is one
 * tab stop; ArrowUp/Down move the active option, Home/End jump to first/last,
 * Enter/Space select. Result order is rendered verbatim from `rows` — never
 * re-sorted (blueprint §14 acceptance).
 */
export function ResultList({ rows, onSelect }: ResultListProps): React.ReactElement {
  const [activeIndex, setActiveIndex] = useState(0);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

  // Clamp/reset the active index when the result set changes underneath us.
  useEffect(() => {
    setActiveIndex((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows]);

  const moveTo = useCallback(
    (index: number) => {
      if (rows.length === 0) {
        return;
      }
      const clamped = Math.max(0, Math.min(index, rows.length - 1));
      setActiveIndex(clamped);
      optionRefs.current[clamped]?.focus();
    },
    [rows.length]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveTo(activeIndex + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveTo(activeIndex - 1);
          break;
        case "Home":
          event.preventDefault();
          moveTo(0);
          break;
        case "End":
          event.preventDefault();
          moveTo(rows.length - 1);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (rows[activeIndex] !== undefined) {
            onSelect(rows[activeIndex].entityKey);
          }
          break;
        default:
          break;
      }
    },
    [activeIndex, moveTo, onSelect, rows]
  );

  return (
    <ul
      role="listbox"
      aria-label="Search results"
      className="search-result-list"
      onKeyDown={onKeyDown}
    >
      {rows.map((row, index) => {
        const active = index === activeIndex;
        const loc = fileLine(row);
        return (
          <li
            key={row.entityKey}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            role="option"
            aria-selected={active}
            aria-label={rowLabel(row)}
            tabIndex={active ? 0 : -1}
            className="search-result-row"
            onClick={() => {
              setActiveIndex(index);
              onSelect(row.entityKey);
            }}
          >
            <span className="search-result-kind">{row.kind}</span>
            <span className="search-result-name">{row.qualifiedName}</span>
            {loc !== null && <span className="search-result-loc">{loc}</span>}
            {row.exactMatch && (
              <span className="search-result-badge" aria-hidden="true">
                exact
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
