import { useMemo, type ReactElement } from "react";
import type { ApiNode } from "../../api/types.ts";
import type { BoundaryViolation } from "./boundariesApi.ts";
import { violationFilePath } from "./boundariesApi.ts";

/** A 2D layout coordinate, read verbatim from the existing layout endpoint. */
export interface BadgePosition {
  x: number;
  y: number;
}

interface BoundaryBadgeOverlayProps {
  /** Violations from useBoundaries (GET /api/v1/boundaries). */
  violations: readonly BoundaryViolation[];
  /**
   * The nodes currently rendered on the canvas (package level, plus any expanded
   * file nodes). Used ONLY to resolve a violation's `file:<path>` source to the
   * entityKey of a placed node — a violation whose file has no node here is
   * surfaced as "unplaced", never guessed.
   */
  nodes: readonly ApiNode[];
  /**
   * Existing layout coordinates keyed by entityKey (from the same fetchLayout the
   * canvas uses). This overlay runs NO layout of its own — a node absent from this
   * map is unplaced, never drawn at 0,0.
   */
  positions: ReadonlyMap<string, BadgePosition>;
  /** True when a tadori.rules.json was found. Drives the "no rules" vs "clean" copy. */
  rulesPresent: boolean;
  /** Set when the boundaries fetch failed (e.g. a malformed rules file). */
  error?: Error | null;
  /** Open the offending file through the EXISTING inspection store. */
  onInspect?: (entityKey: string, entityType: "node") => void;
}

/** A violation whose source file resolved to a PLACED node — draw a badge. */
interface PlacedViolationBadge {
  key: string;
  entityKey: string;
  violation: BoundaryViolation;
  x: number;
  y: number;
}

/** A violation whose source file has no placed node (e.g. package collapsed). */
interface UnplacedViolationBadge {
  key: string;
  entityKey: string | null;
  violation: BoundaryViolation;
}

/** Highest severity present, for the summary heading ("error" outranks "warning"). */
function worstSeverity(violations: readonly BoundaryViolation[]): "error" | "warning" | null {
  let seen: "error" | "warning" | null = null;
  for (const v of violations) {
    if (v.severity === "error") {
      return "error";
    }
    seen = "warning";
  }
  return seen;
}

function violationLabel(v: BoundaryViolation): string {
  const src = violationFilePath(v.src);
  const dst = violationFilePath(v.dst);
  return `${v.severity}: ${src} ${v.edgeRelation} ${dst} (rule ${v.ruleId})`;
}

/**
 * Map each violation's `file:<path>` source to the entityKey of a currently
 * rendered node. A file node carries that path in `.file`; the single package
 * node has `file: null` so it never matches (violations are file crossings, not
 * package identities). One entry per violation, order preserved.
 */
export function partitionViolations(
  violations: readonly BoundaryViolation[],
  nodes: readonly ApiNode[],
  positions: ReadonlyMap<string, BadgePosition>
): { placed: PlacedViolationBadge[]; unplaced: UnplacedViolationBadge[] } {
  const keyByFile = new Map<string, string>();
  for (const node of nodes) {
    if (node.file !== null) {
      keyByFile.set(node.file, node.entityKey);
    }
  }
  const placed: PlacedViolationBadge[] = [];
  const unplaced: UnplacedViolationBadge[] = [];
  violations.forEach((violation, index) => {
    const key = `${violation.ruleId}:${violation.src}:${violation.dst}:${index}`;
    const filePath = violationFilePath(violation.src);
    const entityKey = keyByFile.get(filePath) ?? null;
    const pos = entityKey === null ? undefined : positions.get(entityKey);
    if (entityKey === null || pos === undefined) {
      unplaced.push({ key, entityKey, violation });
      return;
    }
    placed.push({ key, entityKey, violation, x: pos.x, y: pos.y });
  });
  return { placed, unplaced };
}

/**
 * Non-moving boundary-violation overlay. Renders one warning glyph per violation
 * at the EXISTING layout coordinate of the offending source file (read verbatim
 * from `positions`); it computes no layout. A violation whose source file has no
 * placed node (its package is collapsed, so only the package hull is on screen)
 * goes into an explicit "unplaced" list with its full crossing, never a guessed
 * position. Clicking a badge opens the offending file in the inspection panel.
 */
export function BoundaryBadgeOverlay({
  violations,
  nodes,
  positions,
  rulesPresent,
  error,
  onInspect
}: BoundaryBadgeOverlayProps): ReactElement {
  const { placed, unplaced } = useMemo(
    () => partitionViolations(violations, nodes, positions),
    [violations, nodes, positions]
  );

  if (error !== null && error !== undefined) {
    return (
      <div className="boundary-overlay" role="alert" aria-label="Boundary rules error">
        <p className="boundary-error">{`Boundary rules could not be evaluated: ${error.message}`}</p>
      </div>
    );
  }

  const total = violations.length;
  const severity = worstSeverity(violations);

  return (
    <div className="boundary-overlay" aria-label="Boundary violations">
      <div className="boundary-badge-layer" role="group" aria-label="Placed boundary violations">
        {placed.map((badge) => (
          <button
            key={badge.key}
            type="button"
            className={`boundary-badge boundary-badge-${badge.violation.severity}`}
            style={{ position: "absolute", left: badge.x, top: badge.y }}
            aria-label={violationLabel(badge.violation)}
            onClick={() => onInspect?.(badge.entityKey, "node")}
          >
            <span aria-hidden="true">⚠</span>
          </button>
        ))}
      </div>

      <div className="boundary-summary" role="status" aria-live="polite">
        {!rulesPresent ? (
          <p className="boundary-none">No boundary rules declared (add a tadori.rules.json).</p>
        ) : total === 0 ? (
          <p className="boundary-clean">No boundary violations.</p>
        ) : (
          <p className={`boundary-count boundary-count-${severity}`}>
            {`${total} boundary violation${total === 1 ? "" : "s"}${severity === "error" ? "" : " (warnings)"}.`}
          </p>
        )}
      </div>

      {unplaced.length > 0 && (
        <div className="boundary-unplaced" role="status" aria-label="Boundary violations without a layout position">
          <p>
            {`${unplaced.length} violation${unplaced.length === 1 ? "" : "s"} in files not currently on the map (expand the package to place):`}
          </p>
          <ul>
            {unplaced.map((badge) => (
              <li key={badge.key}>
                <button
                  type="button"
                  className={`boundary-unplaced-item boundary-badge-${badge.violation.severity}`}
                  disabled={badge.entityKey === null}
                  onClick={() => badge.entityKey !== null && onInspect?.(badge.entityKey, "node")}
                >
                  {violationLabel(badge.violation)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
