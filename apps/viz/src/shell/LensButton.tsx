import type { ReactElement } from "react";

export interface LensButtonProps {
  active: boolean;
  label: string;
  symbol: string;
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
        {/* Four unlabelled letters — B, delta, A, P — asked the reader to
            memorise a legend that was never shown anywhere. The word is the
            control. Exactly one of these is displayed at a time: showing both
            makes the visible text read "BBoundaries", which is not contained
            in the accessible name and fails WCAG 2.5.3 Label in Name. The
            symbol stays aria-hidden, so on the narrow rail the accessible name
            is the sole label, exactly as it was before. */}
        <span aria-hidden="true" className="lens-button-symbol">{props.symbol}</span>
        <span className="lens-button-label">{props.label}</span>
      </button>
      {disabled && <span id={reasonId} className="tadori-visually-hidden">{props.disabledReason}</span>}
    </>
  );
}
