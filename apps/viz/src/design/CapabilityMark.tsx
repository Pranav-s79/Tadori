export type VisualCapability =
  | "semantic"
  | "structural"
  | "repository"
  | "unknown"
  | "unsupported";

const LABELS: Readonly<Record<VisualCapability, string>> = {
  semantic: "Semantic",
  structural: "Structural",
  repository: "Repository only",
  unknown: "Unknown text",
  unsupported: "Unsupported"
};

const DESCRIPTIONS: Readonly<Record<VisualCapability, string>> = {
  semantic: "Compiler-resolved analysis is available",
  structural: "Parser-derived structure is available",
  repository: "Repository-level facts are available",
  unknown: "The file is present but its language is not registered",
  unsupported: "The file is present but deliberately not analyzed"
};

export interface CapabilityMarkProps {
  capability: VisualCapability;
  showDescription?: boolean;
}

/**
 * A texture plus explicit text. Capability is never communicated by color or
 * archaeological condition alone, and unsupported content remains visible.
 */
export function CapabilityMark({
  capability,
  showDescription = false
}: CapabilityMarkProps) {
  const label = LABELS[capability];
  const description = DESCRIPTIONS[capability];
  return (
    <span
      className="tadori-capability-mark"
      data-capability={capability}
      aria-label={`${label}: ${description}`}
    >
      <span className="tadori-capability-mark__sample" aria-hidden="true" />
      <span>{label}</span>
      {showDescription && <span>— {description}</span>}
    </span>
  );
}
