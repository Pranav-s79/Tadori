import type { ReactElement } from "react";

export interface LensButtonProps {
  active: boolean;
  label: string;
  onClick(): void;
  disabledReason?: string;
}
export function LensButton(props: LensButtonProps): ReactElement {
  const disabled = props.disabledReason !== undefined;
  const reasonId = `lens-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-reason`;
  return (
    <>
      <button
        type="button"
        className="lens-button"
        aria-label={disabled ? `${props.label} lens unavailable: ${props.disabledReason}` : `${props.label} lens`}
        aria-pressed={props.active}
        aria-describedby={disabled ? reasonId : undefined}
        aria-disabled={disabled}
        disabled={disabled}
        title={disabled ? props.disabledReason : `${props.label} lens`}
        onClick={props.onClick}
      >
        {/* The word is the whole visible label at every width. The narrow rail
            used to swap it for a single letter — B, delta, A, P — that asked
            the reader to memorise a legend shown nowhere; it now sets the same
            word vertically. A shorter word ("Bounds") would not be contained
            in the accessible name "Boundaries lens" and would fail WCAG 2.5.3
            Label in Name. The lamp is an empty aria-hidden span: it shows the
            pressed state as filled versus hollow and is never announced. */}
        <span aria-hidden="true" className="lens-button-lamp" />
        <span className="lens-button-label">{props.label}</span>
      </button>
      {disabled && <span id={reasonId} className="tadori-visually-hidden">{props.disabledReason}</span>}
    </>
  );
}
