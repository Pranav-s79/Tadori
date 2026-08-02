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
            control; the symbol is a secondary cue that survives the narrow
            rail, where the word is hidden but stays in the accessible name. */}
        <span aria-hidden="true" className="lens-button-symbol">{props.symbol}</span>
        <span aria-hidden="true" className="lens-button-label">{props.label}</span>
      </button>
      {disabled && <span id={reasonId} className="tadori-visually-hidden">{props.disabledReason}</span>}
    </>
  );
}
