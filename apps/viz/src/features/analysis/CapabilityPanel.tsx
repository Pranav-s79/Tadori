import type { ReactElement } from "react";
import type { CapabilityLanguageDto, CapabilityState } from "../../api/types.ts";
import type { UseCapabilitiesResult } from "../../hooks/useCapabilities.ts";

/**
 * Whether the active snapshot actually observed a declared language.
 *
 * Declared support and observed extraction are different claims and must never
 * be collapsed. "Declared structural" says what this build of Tadori can do; it
 * is not evidence that anything was parsed here. A language present in the
 * contract but absent from the snapshot is "not present in this repository",
 * never "verified".
 */
export type ObservationStatus = "observed" | "not_in_snapshot";

export function observationStatus(
  languageId: string,
  observedLanguageIds: readonly string[]
): ObservationStatus {
  return observedLanguageIds.includes(languageId) ? "observed" : "not_in_snapshot";
}

const OBSERVATION_TEXT: Readonly<Record<ObservationStatus, string>> = {
  observed: "Observed in this snapshot",
  not_in_snapshot: "Not present in this repository"
};

/**
 * The headline support level a language declares, read from the two resolution
 * features rather than invented. The declared state is returned verbatim so the
 * contract's own vocabulary is never paraphrased into a friendlier word.
 */
export function declaredResolution(language: CapabilityLanguageDto): CapabilityState {
  const semantic = language.features.semanticResolution;
  if (semantic === "semantic" || semantic === "experimental") return semantic;
  return language.features.structuralResolution ?? "unsupported";
}

export function CapabilityPanel({
  capabilities,
  observedLanguageIds
}: {
  capabilities: UseCapabilitiesResult;
  observedLanguageIds: readonly string[];
}): ReactElement {
  if (capabilities.error !== null) {
    return (
      <p className="analysis-empty" role="alert">
        Declared capabilities unavailable: {capabilities.error.message}
      </p>
    );
  }
  if (capabilities.data === null) {
    return (
      <p className="analysis-empty" role="status">
        {capabilities.loading
          ? "Loading declared capabilities…"
          : "No capability contract available."}
      </p>
    );
  }

  const { claim, languages } = capabilities.data;
  return (
    <div className="capability-panel">
      <p className="capability-claim">{claim}</p>
      <table className="capability-languages">
        <caption>
          Support this build of Tadori <strong>declares</strong>, paired with what
          this snapshot actually observed. Declared support is a product contract,
          never evidence that a language was analyzed here.
        </caption>
        <thead>
          <tr>
            <th scope="col">Language</th>
            <th scope="col">Declared</th>
            <th scope="col">In this repository</th>
            <th scope="col">Extractor</th>
          </tr>
        </thead>
        <tbody>
          {languages.map((language) => {
            const status = observationStatus(language.id, observedLanguageIds);
            return (
              <tr key={language.id} data-observation={status}>
                <th scope="row"><code>{language.id}</code></th>
                <td>{declaredResolution(language)}</td>
                <td>{OBSERVATION_TEXT[status]}</td>
                <td>
                  <code>{language.extractorId}@{language.extractorVersion}</code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
