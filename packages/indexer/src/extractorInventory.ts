import type {
  ExtractionCapability,
  GraphEdge,
  GraphFile,
  GraphNode,
  GraphProject,
  SnapshotDiagnostic,
  SnapshotExtractor
} from "@tadori/core";
import {
  LANGUAGE_BY_ID,
  LANGUAGE_REGISTRY,
  UNKNOWN_TEXT_LANGUAGE
} from "./languageRegistry.js";

interface InventoryEntry {
  id: string;
  version: string;
  capability: ExtractionCapability;
  languages: Set<string>;
}

export interface SnapshotExtractorInventoryInput {
  inventories: ReadonlyArray<readonly SnapshotExtractor[] | undefined>;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  files: readonly GraphFile[];
  projects: readonly GraphProject[];
  diagnostics: readonly SnapshotDiagnostic[];
}

const CAPABILITY_RANK: Readonly<Record<ExtractionCapability, number>> = {
  repository: 0,
  structural: 1,
  semantic: 2
};

function keyOf(id: string, version: string): string {
  return `${id}\0${version}`;
}

function strongerCapability(
  left: ExtractionCapability | undefined,
  right: ExtractionCapability
): ExtractionCapability {
  return left === undefined || CAPABILITY_RANK[right] > CAPABILITY_RANK[left] ? right : left;
}

function diagnosticCapability(
  diagnostic: SnapshotDiagnostic,
  entries: ReadonlyMap<string, InventoryEntry>,
  declarations: ReadonlyMap<string, InventoryEntry>
): ExtractionCapability | null {
  const existing = entries.get(keyOf(diagnostic.extractorId, diagnostic.extractorVersion));
  if (existing !== undefined) return existing.capability;
  const declared = declarations.get(keyOf(diagnostic.extractorId, diagnostic.extractorVersion));
  if (declared !== undefined) return declared.capability;
  if (diagnostic.language === null) return null;
  const registration = diagnostic.language === UNKNOWN_TEXT_LANGUAGE.id
    ? UNKNOWN_TEXT_LANGUAGE
    : LANGUAGE_BY_ID.get(diagnostic.language);
  if (
    registration?.extractorId === diagnostic.extractorId &&
    registration.extractorVersion === diagnostic.extractorVersion
  ) {
    return registration.capability;
  }
  throw new Error(
    `Diagnostic extractor ${JSON.stringify(diagnostic.extractorId)} version ` +
    `${JSON.stringify(diagnostic.extractorVersion)} for language ` +
    `${JSON.stringify(diagnostic.language)} has no declared capability`
  );
}

const FILE_PARTICIPATION_EXTRACTORS = new Set([
  "tadori-tree-sitter",
  "tadori-interface-files"
]);
const PROJECT_PARTICIPATION_EXTRACTOR = "tadori-interface-files";

function declaredInventory(
  inventories: SnapshotExtractorInventoryInput["inventories"]
): Map<string, InventoryEntry> {
  const declarations = new Map<string, InventoryEntry>();
  for (const inventory of inventories) {
    for (const extractor of inventory ?? []) {
      const key = keyOf(extractor.id, extractor.version);
      const existing = declarations.get(key);
      declarations.set(key, {
        id: extractor.id,
        version: extractor.version,
        capability: strongerCapability(existing?.capability, extractor.capability),
        languages: new Set([...(existing?.languages ?? []), ...extractor.languages])
      });
    }
  }
  return declarations;
}

/**
 * Rebuilds the immutable snapshot inventory from actual retained contribution.
 * Nodes, edges, and diagnostics contribute directly. Bundled structural and
 * interface adapters additionally declare file participation, while discovered
 * projects are explicitly owned by the interface adapter. Seed inventories are
 * capability declarations only; they never keep an extractor alive by language
 * presence alone.
 */
export function buildSnapshotExtractorInventory(
  input: SnapshotExtractorInventoryInput
): SnapshotExtractor[] {
  const entries = new Map<string, InventoryEntry>();
  const declarations = declaredInventory(input.inventories);
  const add = (
    id: string,
    version: string,
    capability: ExtractionCapability,
    languages: Iterable<string>
  ): void => {
    const key = keyOf(id, version);
    const existing = entries.get(key);
    const observedLanguages = new Set(existing?.languages ?? []);
    for (const language of languages) observedLanguages.add(language);
    entries.set(key, {
      id,
      version,
      capability: strongerCapability(existing?.capability, capability),
      languages: observedLanguages
    });
  };

  for (const item of [...input.nodes, ...input.edges]) {
    if (item.provenance === undefined) continue;
    add(
      item.provenance.extractorId,
      item.provenance.extractorVersion,
      item.provenance.capability,
      item.language === null || item.language === undefined ? [] : [item.language]
    );
  }
  for (const diagnostic of input.diagnostics) {
    const capability = diagnosticCapability(diagnostic, entries, declarations);
    if (capability === null) continue;
    add(
      diagnostic.extractorId,
      diagnostic.extractorVersion,
      capability,
      diagnostic.language === null ? [] : [diagnostic.language]
    );
  }
  for (const file of input.files) {
    if (file.language === null) continue;
    const registration = file.language === UNKNOWN_TEXT_LANGUAGE.id
      ? UNKNOWN_TEXT_LANGUAGE
      : LANGUAGE_BY_ID.get(file.language);
    if (
      registration !== undefined &&
      FILE_PARTICIPATION_EXTRACTORS.has(registration.extractorId)
    ) {
      add(
        registration.extractorId,
        registration.extractorVersion,
        registration.capability,
        [file.language]
      );
    }
  }
  if (input.projects.length > 0) {
    const registration = LANGUAGE_REGISTRY.find(
      (candidate) => candidate.extractorId === PROJECT_PARTICIPATION_EXTRACTOR
    );
    if (registration === undefined) {
      throw new Error("Interface project extractor is absent from the language registry");
    }
    add(
      registration.extractorId,
      registration.extractorVersion,
      registration.capability,
      input.projects.flatMap((project) => project.languages)
    );
  }

  return [...entries.values()]
    .filter((entry) => entry.languages.size > 0)
    .map((entry): SnapshotExtractor => ({
      id: entry.id,
      version: entry.version,
      capability: entry.capability,
      languages: [...entry.languages].sort()
    }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version));
}
