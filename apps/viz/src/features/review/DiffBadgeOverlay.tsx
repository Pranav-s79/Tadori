import { useMemo, type ReactElement } from "react";
import type { AccumulatedDiff } from "./useReviewDiffStore.ts";

/** A 2D layout coordinate, read verbatim from the existing layout endpoint. */
export interface BadgePosition {
  x: number;
  y: number;
}

/** How a changed node is marked. */
export type BadgeKind = "added" | "removed" | "changed-relationship";

interface DiffBadgeOverlayProps {
  /** The accumulated diff (from useReviewDiffStore). */
  page: AccumulatedDiff | null;
  /**
   * Existing layout coordinates keyed by entityKey. MUST come from the existing
   * fetchLayout(level) — this component runs NO layout of its own (no
   * graphology/sigma import, no force layout, no position guessing). A node
   * absent from this map has no coordinate and is surfaced as "unplaced", never
   * placed at 0,0.
   */
  positions: ReadonlyMap<string, BadgePosition>;
  /** Open evidence/source through the EXISTING inspection store (same as the list). */
  onInspect?: (entityKey: string, entityType: "node") => void;
}

/** One placeable badge: a changed node that HAS a layout coordinate. */
interface PlacedBadge {
  entityKey: string;
  label: string;
  badgeKind: BadgeKind;
  x: number;
  y: number;
}

/** A changed node with NO layout coordinate — listed honestly, not placed. */
interface UnplacedBadge {
  entityKey: string;
  label: string;
  badgeKind: BadgeKind;
}

/**
 * The set of entityKeys touched by this diff. Callers use it to dim/omit
 * unrelated graph elements (the dimming itself is the caller's concern — this is
 * the derivation hook). Edge rows carry qualifiedNames, not entityKeys, so only
 * node changes contribute placeable keys; edge endpoints cannot be matched to a
 * layout entityKey from the wire row, so they are intentionally excluded here.
 */
export function changedEntityKeys(page: AccumulatedDiff | null): Set<string> {
  const keys = new Set<string>();
  if (page === null) {
    return keys;
  }
  for (const node of page.nodesAdded) {
    keys.add(node.entityKey);
  }
  for (const node of page.nodesRemoved) {
    keys.add(node.entityKey);
  }
  return keys;
}

function partitionBadges(
  page: AccumulatedDiff | null,
  positions: ReadonlyMap<string, BadgePosition>
): { placed: PlacedBadge[]; unplaced: UnplacedBadge[] } {
  const placed: PlacedBadge[] = [];
  const unplaced: UnplacedBadge[] = [];
  if (page === null) {
    return { placed, unplaced };
  }
  const consider = (entityKey: string, label: string, badgeKind: BadgeKind): void => {
    const pos = positions.get(entityKey);
    if (pos === undefined) {
      unplaced.push({ entityKey, label, badgeKind });
      return;
    }
    placed.push({ entityKey, label, badgeKind, x: pos.x, y: pos.y });
  };
  for (const node of page.nodesAdded) {
    consider(node.entityKey, node.qualifiedName, "added");
  }
  for (const node of page.nodesRemoved) {
    consider(node.entityKey, node.qualifiedName, "removed");
  }
  return { placed, unplaced };
}

/**
 * Non-moving badge overlay. Renders one badge per changed NODE at its EXISTING
 * layout coordinate (read verbatim from `positions`). It never computes a
 * layout: no graphology/sigma import, no force simulation, no fallback position.
 * A changed node with no coordinate goes into an explicit "unplaced" list rather
 * than being drawn at a guessed spot. Selecting a badge opens the same
 * inspection target as the list row.
 */
export function DiffBadgeOverlay({ page, positions, onInspect }: DiffBadgeOverlayProps): ReactElement {
  const { placed, unplaced } = useMemo(() => partitionBadges(page, positions), [page, positions]);

  return (
    <div className="diff-badge-overlay" aria-label="Diff badges">
      <div className="diff-badge-layer" role="group" aria-label="Placed diff badges">
        {placed.map((badge) => (
          <button
            key={badge.entityKey}
            type="button"
            className={`diff-badge diff-badge-${badge.badgeKind}`}
            style={{ position: "absolute", left: badge.x, top: badge.y }}
            aria-label={`${badge.badgeKind} ${badge.label}`}
            onClick={() => onInspect?.(badge.entityKey, "node")}
          >
            <span aria-hidden="true">{badge.badgeKind === "added" ? "+" : badge.badgeKind === "removed" ? "−" : "~"}</span>
          </button>
        ))}
      </div>

      {unplaced.length > 0 && (
        <div className="diff-badge-unplaced" role="status" aria-label="Unplaced diff badges">
          <p>{`${unplaced.length} changed node${unplaced.length === 1 ? "" : "s"} without a layout position:`}</p>
          <ul>
            {unplaced.map((badge) => (
              <li key={badge.entityKey}>
                <button
                  type="button"
                  className={`diff-badge-unplaced-item diff-badge-${badge.badgeKind}`}
                  onClick={() => onInspect?.(badge.entityKey, "node")}
                >
                  {`${badge.badgeKind}: ${badge.label}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
