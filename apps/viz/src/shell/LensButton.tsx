import type { ReactElement } from "react";

export interface LensButtonProps {
  active: boolean;
  label: string;
  onClick(): void;
}

/**
 * One key in the map toolbar's lens group. The word is the whole visible label
 * and is contained in the accessible name ("Boundaries lens"), per WCAG 2.5.3
 * Label in Name. The lamp is an empty aria-hidden span: it shows the pressed
 * state as filled versus hollow and is never announced; aria-pressed carries
 * the state itself.
 */
export function LensButton(props: LensButtonProps): ReactElement {
  return (
    <button
      type="button"
      className="lens-button"
      aria-label={`${props.label} lens`}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      <span aria-hidden="true" className="lens-button-lamp" />
      <span className="lens-button-label">{props.label}</span>
    </button>
  );
}
