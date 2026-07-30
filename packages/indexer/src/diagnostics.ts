import type { GraphFile, SnapshotDiagnostic, SnapshotExtractor } from "@tadori/core";
import type { IndexDiagnostic } from "./extract.js";
import {
  TYPESCRIPT_EXTRACTOR_ID,
  TYPESCRIPT_EXTRACTOR_VERSION
} from "./typescriptExtractor.js";
import { LANGUAGE_BY_ID, UNKNOWN_TEXT_LANGUAGE } from "./languageRegistry.js";

const TRANSIENT_DIAGNOSTIC_CODES = new Set(["typescript-call-resolution-summary"]);

/**
 * Converts extractor diagnostics into deterministic immutable snapshot data.
 * Extraction-run metrics remain transient because a regional run cannot
 * truthfully describe the complete snapshot.
 */
export function snapshotDiagnostics(
  diagnostics: readonly IndexDiagnostic[],
  files: readonly GraphFile[],
  extractors: readonly SnapshotExtractor[] | undefined
): SnapshotDiagnostic[] {
  const languageByFile = new Map(files.map((file) => [file.normalizedPath, file.language]));
  const versionByExtractor = new Map(
    (extractors ?? []).map((extractor) => [extractor.id, extractor.version])
  );
  const normalized = diagnostics
    .filter((diagnostic) => !TRANSIENT_DIAGNOSTIC_CODES.has(diagnostic.code ?? ""))
    .map((diagnostic): SnapshotDiagnostic => {
      const inferredLanguage = diagnostic.language ?? (
        diagnostic.file === null ? null : languageByFile.get(diagnostic.file) ?? null
      );
      const languageRegistration = inferredLanguage === null
        ? undefined
        : inferredLanguage === UNKNOWN_TEXT_LANGUAGE.id
          ? UNKNOWN_TEXT_LANGUAGE
          : LANGUAGE_BY_ID.get(inferredLanguage);
      const extractorId = diagnostic.extractorId ?? (
        languageRegistration?.extractorId ?? (
          diagnostic.file === null ? "tadori-repository" : TYPESCRIPT_EXTRACTOR_ID
        )
      );
      const lineStart = diagnostic.lineStart ?? diagnostic.lineEnd ?? null;
      const lineEnd = diagnostic.lineEnd ?? diagnostic.lineStart ?? null;
      return {
        code: diagnostic.code ?? "typescript-analysis",
        severity: diagnostic.severity ?? "warning",
        message: diagnostic.message,
        file: diagnostic.file,
        language: inferredLanguage,
        extractorId,
        extractorVersion:
          diagnostic.extractorVersion ??
          versionByExtractor.get(extractorId) ??
          (languageRegistration?.extractorId === extractorId
            ? languageRegistration.extractorVersion
            : undefined) ??
          (extractorId === TYPESCRIPT_EXTRACTOR_ID
            ? TYPESCRIPT_EXTRACTOR_VERSION
            : extractorId === UNKNOWN_TEXT_LANGUAGE.extractorId
              ? UNKNOWN_TEXT_LANGUAGE.extractorVersion
              : "unknown"),
        lineStart,
        lineEnd
      };
    })
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return [...new Map(normalized.map((diagnostic) => [JSON.stringify(diagnostic), diagnostic])).values()];
}
