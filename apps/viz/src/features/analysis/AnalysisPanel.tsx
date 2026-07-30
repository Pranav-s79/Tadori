import type { ReactElement } from "react";
import { CapabilityMark } from "../../design/CapabilityMark.tsx";
import type { SnapshotAnalysisDto, SnapshotDiagnostic } from "../../api/types.ts";
import type { UseAnalysisResult } from "../../hooks/useAnalysis.ts";

const SEVERITY_ORDER: ReadonlyArray<SnapshotDiagnostic["severity"]> = ["error", "warning", "info"];

/**
 * A short sentence naming every severity that is actually present. Returns null
 * when the snapshot reported no diagnostics, so callers render a distinct clean
 * state rather than a row of zeros.
 */
export function diagnosticSeveritySummary(
  bySeverity: Readonly<Record<SnapshotDiagnostic["severity"], number>>
): string | null {
  const present = SEVERITY_ORDER
    .filter((severity) => bySeverity[severity] > 0)
    .map((severity) => {
      const count = bySeverity[severity];
      return `${String(count)} ${severity}${count === 1 ? "" : "s"}`;
    });
  return present.length === 0 ? null : present.join(", ");
}

function diagnosticLocation(diagnostic: SnapshotDiagnostic): string {
  if (diagnostic.file === null) return "repository";
  if (diagnostic.lineStart === null) return diagnostic.file;
  return diagnostic.lineStart === diagnostic.lineEnd
    ? `${diagnostic.file}:${String(diagnostic.lineStart)}`
    : `${diagnostic.file}:${String(diagnostic.lineStart)}-${String(diagnostic.lineEnd)}`;
}

function ObservedLanguages({ analysis }: { analysis: SnapshotAnalysisDto }): ReactElement {
  if (analysis.languages.length === 0) {
    return <p className="analysis-empty">No language was observed in this snapshot.</p>;
  }
  return (
    <table className="analysis-languages">
      <caption>
        Languages observed in snapshot #{analysis.snapshotId}. This is what this
        snapshot actually extracted, not the product&rsquo;s declared support.
      </caption>
      <thead>
        <tr>
          <th scope="col">Language</th>
          <th scope="col">Files</th>
          <th scope="col">Generated</th>
          <th scope="col">Analysis available</th>
        </tr>
      </thead>
      <tbody>
        {analysis.languages.map((language) => (
          <tr key={language.id}>
            <th scope="row"><code>{language.id}</code></th>
            <td>{language.fileCount}</td>
            <td>{language.generatedFileCount}</td>
            <td>
              {language.capabilities.length === 0 ? (
                <CapabilityMark capability="unknown" />
              ) : (
                language.capabilities.map((capability) => (
                  <CapabilityMark key={capability} capability={capability} />
                ))
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DiagnosticList({ analysis }: { analysis: SnapshotAnalysisDto }): ReactElement {
  const { items, total, omittedCount } = analysis.diagnostics;
  if (total === 0) {
    return (
      <p className="analysis-empty">
        No extraction diagnostic was recorded. Every indexed file was read at its
        reported capability.
      </p>
    );
  }
  return (
    <>
      <p className="analysis-budget" role="status">
        {omittedCount === 0
          ? `Showing all ${String(total)} diagnostics.`
          : `Showing ${String(items.length)} of ${String(total)} diagnostics; ${String(omittedCount)} not shown.`}
      </p>
      <ul className="analysis-diagnostics">
        {items.map((diagnostic, index) => (
          <li
            key={`${diagnostic.code}:${diagnosticLocation(diagnostic)}:${String(index)}`}
            data-severity={diagnostic.severity}
          >
            <p className="analysis-diagnostic-head">
              <span className="analysis-severity">{diagnostic.severity}</span>
              <code>{diagnostic.code}</code>
            </p>
            <p className="analysis-diagnostic-message">{diagnostic.message}</p>
            <p className="analysis-diagnostic-meta">
              <code>{diagnosticLocation(diagnostic)}</code>
              {diagnostic.language !== null && <span>{diagnostic.language}</span>}
              <span>{diagnostic.extractorId}@{diagnostic.extractorVersion}</span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Extraction diagnostics and observed language facts for the active snapshot.
 *
 * This is the honest answer to "why is this file thin?" — a parser failure is
 * scoped and recorded, so it must stay visible rather than being silently
 * absorbed into a smaller graph. Nothing here claims runtime behavior or
 * declared language parity; it reports only what this snapshot observed.
 */
export function AnalysisPanel({ analysis }: { analysis: UseAnalysisResult }): ReactElement {
  if (analysis.error !== null) {
    return (
      <p className="analysis-empty" role="alert">
        Analysis facts unavailable: {analysis.error.message}
      </p>
    );
  }
  if (analysis.data === null) {
    return (
      <p className="analysis-empty" role="status">
        {analysis.loading ? "Loading analysis facts…" : "No analysis facts available."}
      </p>
    );
  }
  return (
    <div className="analysis-panel">
      <ObservedLanguages analysis={analysis.data} />
      <h3 className="analysis-subheading">Extraction diagnostics</h3>
      <DiagnosticList analysis={analysis.data} />
      <p className="analysis-analyzer">
        Analyzer <code>{analysis.data.analyzerVersion}</code>
      </p>
    </div>
  );
}
