import type { ReactElement } from "react";

export type SpatialProjection = "plan" | "relief";

interface SpatialProjectionToggleProps {
  active: SpatialProjection;
  onChange(projection: SpatialProjection): void;
}

export function SpatialProjectionToggle({ active, onChange }: SpatialProjectionToggleProps): ReactElement {
  return (
    <div className="spatial-projection-toggle" role="group" aria-label="Atlas projection">
      <button type="button" aria-pressed={active === "plan"} onClick={() => onChange("plan")}>Plan</button>
      <button type="button" aria-pressed={active === "relief"} onClick={() => onChange("relief")}>Relief</button>
    </div>
  );
}
