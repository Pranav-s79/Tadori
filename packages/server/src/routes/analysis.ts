import type { ExtractionCapability, SnapshotExtractor } from "@tadori/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { badRequest } from "../errors.js";
import type { SnapshotAnalysisDto, SnapshotLanguageAnalysisDto } from "../types.js";

const DEFAULT_DIAGNOSTIC_LIMIT = 100;
const MAX_DIAGNOSTIC_LIMIT = 500;
const CAPABILITY_ORDER: readonly ExtractionCapability[] = ["semantic", "structural", "repository"];

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number | null {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function extractorSummary(extractor: SnapshotExtractor): Pick<
  SnapshotExtractor,
  "id" | "version" | "capability"
> {
  return { id: extractor.id, version: extractor.version, capability: extractor.capability };
}

/** Serves bounded diagnostics and observed language/extractor facts for the active snapshot. */
export async function registerAnalysisRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/analysis",
    async (
      request: FastifyRequest<{
        Querystring: { diagnosticCursor?: string; diagnosticLimit?: string };
      }>,
      reply: FastifyReply
    ) => {
      const cursor = parseBoundedInteger(request.query.diagnosticCursor, 0, 0, 1_000_000);
      const limit = parseBoundedInteger(
        request.query.diagnosticLimit,
        DEFAULT_DIAGNOSTIC_LIMIT,
        1,
        MAX_DIAGNOSTIC_LIMIT
      );
      if (cursor === null || limit === null) {
        const { statusCode, payload } = badRequest("bad_diagnostic_page");
        return reply.code(statusCode).send(payload);
      }

      const service = app.graphState.current();
      const languageIds = [...new Set(
        service.graph.files.flatMap((file) => file.language === null ? [] : [file.language])
      )].sort((left, right) => left.localeCompare(right));
      const languages: SnapshotLanguageAnalysisDto[] = languageIds.map((id) => {
        const files = service.graph.files.filter((file) => file.language === id);
        const extractors = service.graph.extractors
          .filter((extractor) => extractor.languages.includes(id))
          .map(extractorSummary);
        const capabilities = [...new Set(extractors.map((extractor) => extractor.capability))]
          .sort((left, right) => CAPABILITY_ORDER.indexOf(left) - CAPABILITY_ORDER.indexOf(right));
        return {
          id,
          fileCount: files.length,
          generatedFileCount: files.filter((file) => file.isGenerated).length,
          capabilities,
          extractors
        };
      });
      const allDiagnostics = service.graph.diagnostics;
      const items = allDiagnostics.slice(cursor, cursor + limit);
      const nextOffset = cursor + items.length;
      const body: SnapshotAnalysisDto = {
        snapshotId: service.snapshot.id,
        analyzerVersion: service.graph.analyzerVersion,
        languages,
        extractors: service.graph.extractors,
        diagnostics: {
          items,
          total: allDiagnostics.length,
          omittedCount: Math.max(0, allDiagnostics.length - nextOffset),
          nextCursor: nextOffset < allDiagnostics.length ? String(nextOffset) : null,
          bySeverity: {
            info: allDiagnostics.filter((diagnostic) => diagnostic.severity === "info").length,
            warning: allDiagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
            error: allDiagnostics.filter((diagnostic) => diagnostic.severity === "error").length
          }
        }
      };
      return reply.send(body);
    }
  );
}
