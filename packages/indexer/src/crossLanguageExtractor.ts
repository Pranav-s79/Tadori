import path from "node:path";

import type { Evidence, GraphNode, Relation } from "@tadori/core";
import { edgeCanonicalIdentity, entityKey } from "@tadori/core";
import {
  assertExtractorResult,
  provenance,
  type AttributedGraphEdge,
  type ExtractionContext,
  type ExtractorResult
} from "./extractorContract.js";

const EXTRACTOR_ID = "tadori-cross-language-boundaries";
const EXTRACTOR_VERSION = "1";

interface SourceLine {
  readonly number: number;
  readonly text: string;
}

interface State {
  readonly context: ExtractionContext;
  readonly nodes: readonly GraphNode[];
  readonly edges: Map<string, AttributedGraphEdge>;
  readonly diagnostics: ExtractorResult["diagnostics"];
  readonly capturedPaths: ReadonlySet<string>;
}

function linesOf(source: string): SourceLine[] {
  return source.split(/\r?\n/).map((text, index) => ({ number: index + 1, text }));
}

function anchor(file: string, line: number): Evidence {
  return { file, kind: "source", lineStart: line, lineEnd: line };
}

function compareEvidence(left: Evidence, right: Evidence): number {
  return left.file.localeCompare(right.file) || left.lineStart - right.lineStart || left.lineEnd - right.lineEnd;
}

function normalizePath(sourceFile: string, reference: string): string | null {
  const cleaned = reference.trim().replace(/^['"]|['"]$/g, "").replace(/\\/g, "/");
  if (cleaned.length === 0 || path.posix.isAbsolute(cleaned)) return null;
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), cleaned));
  return normalized === ".." || normalized.startsWith("../") ? null : normalized.replace(/^\.\//, "");
}

function fileNode(state: State, file: string): GraphNode | undefined {
  return state.nodes.find((node) => node.kind === "file" && node.file === file);
}

function enclosingNode(state: State, file: string, line: number): GraphNode | undefined {
  return state.nodes
    .filter((node) =>
      node.file === file && node.kind !== "file" && node.kind !== "unresolved" &&
      node.lineStart !== null && node.lineEnd !== null && node.lineStart <= line && node.lineEnd >= line
    )
    .sort((left, right) =>
      ((left.lineEnd ?? line) - (left.lineStart ?? line)) - ((right.lineEnd ?? line) - (right.lineStart ?? line)) ||
      left.canonicalIdentity.localeCompare(right.canonicalIdentity)
    )[0];
}

function declarationNode(
  state: State,
  file: string,
  name: string,
  line?: number
): GraphNode | undefined {
  const candidates = state.nodes.filter((node) =>
    node.file === file && node.displayName === name &&
    node.kind !== "file" && node.kind !== "unresolved" &&
    (line === undefined || node.lineStart === line)
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function makeEdge(
  source: GraphNode,
  relation: Relation,
  target: GraphNode,
  evidence: readonly Evidence[],
  derivation: "parser-derived" | "convention-derived" | "repository-derived"
): AttributedGraphEdge {
  const canonicalIdentity = edgeCanonicalIdentity(source.entityKey, relation, target.entityKey);
  return {
    srcEntityKey: source.entityKey,
    relation,
    dstEntityKey: target.entityKey,
    canonicalIdentity,
    entityKey: entityKey(canonicalIdentity),
    origin: "heuristic",
    confidence: "certain",
    resolution: "resolved",
    evidence: [...evidence].sort(compareEvidence),
    language: source.language ?? null,
    provenance: provenance(EXTRACTOR_ID, EXTRACTOR_VERSION, "repository", derivation)
  };
}

function addEdge(state: State, edge: AttributedGraphEdge): void {
  const existing = state.edges.get(edge.canonicalIdentity);
  if (existing === undefined) {
    state.edges.set(edge.canonicalIdentity, edge);
    return;
  }
  const seen = new Set(existing.evidence.map((item) => JSON.stringify(item)));
  for (const item of edge.evidence) if (!seen.has(JSON.stringify(item))) existing.evidence.push(item);
  existing.evidence.sort(compareEvidence);
}

function sourceText(context: ExtractionContext, file: string): string | null {
  return context.capture.fileContents.get(file)?.toString("utf8") ?? null;
}

function extractHttpBoundaries(state: State): void {
  interface Endpoint { file: string; line: number; method: string; route: string; target: GraphNode }
  const servers: Endpoint[] = [];
  for (const scanned of state.context.capture.scan.indexedFiles) {
    const source = sourceText(state.context, scanned.normalizedPath);
    if (source === null) continue;
    const lines = linesOf(source);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const decorator = /^\s*@(?:[A-Za-z_]\w*\.)?(get|post|put|patch|delete|head|options)\s*\(\s*["']([^"']+)["']/.exec(line.text);
      if (decorator?.[1] !== undefined && decorator[2] !== undefined) {
        const declaration = lines.slice(index + 1).find((candidate) => /^\s*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(/.test(candidate.text));
        if (declaration === undefined) continue;
        const name = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(declaration.text)?.[1];
        const target = name === undefined ? undefined : declarationNode(state, scanned.normalizedPath, name, declaration.number);
        if (target !== undefined) servers.push({ file: scanned.normalizedPath, line: line.number, method: decorator[1].toUpperCase(), route: decorator[2], target });
      }
      const routeCall = /\b(?:[A-Za-z_$][\w$]*\.)?(get|post|put|patch|delete|head|options)\s*\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)/.exec(line.text);
      if (routeCall?.[1] !== undefined && routeCall[2] !== undefined && routeCall[3] !== undefined) {
        const target = declarationNode(state, scanned.normalizedPath, routeCall[3]);
        if (target !== undefined) servers.push({ file: scanned.normalizedPath, line: line.number, method: routeCall[1].toUpperCase(), route: routeCall[2], target });
      }
    }
  }

  for (const scanned of state.context.capture.scan.indexedFiles) {
    const source = sourceText(state.context, scanned.normalizedPath);
    if (source === null) continue;
    for (const line of linesOf(source)) {
      for (const match of line.text.matchAll(/\b(?:fetch|request)\s*\(\s*["']https?:\/\/[^/"']+(\/[^"']*)["']/g)) {
        const route = match[1];
        if (route === undefined) continue;
        const window = source.split(/\r?\n/).slice(line.number - 1, line.number + 5).join("\n");
        const method = /\bmethod\s*:\s*["']([A-Za-z]+)["']/.exec(window)?.[1]?.toUpperCase() ?? "GET";
        const candidates = servers.filter((server) => server.method === method && server.route === route);
        const sourceNode = enclosingNode(state, scanned.normalizedPath, line.number);
        if (sourceNode !== undefined && candidates.length === 1) {
          const server = candidates[0]!;
          addEdge(state, makeEdge(sourceNode, "routes_to", server.target, [anchor(scanned.normalizedPath, line.number), anchor(server.file, server.line)], "convention-derived"));
        }
      }
    }
  }
}

function generatedProtoPath(file: string, line: string): string | null {
  const reference = /\bgenerated-from:\s*([^\s]+)/i.exec(line)?.[1] ??
    /\bprotoc\b[^\r\n]*?((?:\.\.?\/|[A-Za-z0-9_.-]+\/)[^\s]+\.proto)\b/.exec(line)?.[1];
  return reference === undefined ? null : normalizePath(file, reference);
}

function extractGeneratedBindings(state: State): void {
  for (const scanned of state.context.capture.scan.indexedFiles) {
    const source = sourceText(state.context, scanned.normalizedPath);
    if (source === null) continue;
    const sourceLines = linesOf(source);
    for (const marker of sourceLines) {
      const protoPath = generatedProtoPath(scanned.normalizedPath, marker.text);
      if (protoPath === null || !state.capturedPaths.has(protoPath)) continue;
      const protoFile = fileNode(state, protoPath);
      const sourceFile = fileNode(state, scanned.normalizedPath);
      if (protoFile === undefined || sourceFile === undefined) continue;
      let emittedSymbol = false;
      for (const imported of sourceLines) {
        const pythonImport = /^\s*from\s+[A-Za-z_][\w.]*_pb2\s+import\s+(.+?)(?:\s+#.*)?$/.exec(imported.text)?.[1];
        if (pythonImport === undefined) continue;
        for (const name of pythonImport.split(",").map((part) => part.trim().split(/\s+as\s+/)[0]).filter((part): part is string => part !== undefined && /^[A-Za-z_]\w*$/.test(part))) {
          const target = declarationNode(state, protoPath, name);
          if (target === undefined) continue;
          addEdge(state, makeEdge(sourceFile, "references", target, [anchor(scanned.normalizedPath, marker.number), anchor(scanned.normalizedPath, imported.number), ...(target.lineStart === null ? [] : [anchor(protoPath, target.lineStart)])], "repository-derived"));
          emittedSymbol = true;
        }
      }
      if (!emittedSymbol) {
        const protoSource = sourceText(state.context, protoPath);
        const targetLine = scanned.language === "go" && protoSource !== null
          ? linesOf(protoSource).find((line) => /^\s*option\s+go_package\s*=/.test(line.text))?.number
          : protoFile.lineStart;
        addEdge(state, makeEdge(sourceFile, "references", protoFile, [anchor(scanned.normalizedPath, marker.number), ...(targetLine === null || targetLine === undefined ? [] : [anchor(protoPath, targetLine)])], "repository-derived"));
      }
    }
  }
}

function includedPath(file: string, line: string): string | null {
  const include = /^\s*#\s*include\s*["']([^"']+)["']/.exec(line)?.[1];
  return include === undefined ? null : normalizePath(file, include);
}

function extractFfiBoundaries(state: State): void {
  const headers = new Map<string, Map<string, number>>();
  for (const scanned of state.context.capture.scan.indexedFiles) {
    if (!/\.(?:h|hh|hpp|hxx)$/i.test(scanned.normalizedPath)) continue;
    const source = sourceText(state.context, scanned.normalizedPath);
    if (source === null || !/extern\s+["']C["']/.test(source)) continue;
    const declarations = new Map<string, number>();
    const externLine = linesOf(source).find((line) => /extern\s+["']C["']/.test(line.text))?.number;
    for (const line of linesOf(source)) {
      const name = /^\s*(?:[A-Za-z_]\w*[\s*&]+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*;/.exec(line.text)?.[1];
      if (name !== undefined) declarations.set(name, externLine ?? line.number);
    }
    if (declarations.size > 0) headers.set(scanned.normalizedPath, declarations);
  }

  for (const scanned of state.context.capture.scan.indexedFiles.filter((file) => file.language === "cpp")) {
    const source = sourceText(state.context, scanned.normalizedPath);
    if (source === null) continue;
    const lines = linesOf(source);
    for (const includeLine of lines) {
      const headerPath = includedPath(scanned.normalizedPath, includeLine.text);
      const declarations = headerPath === null ? undefined : headers.get(headerPath);
      if (headerPath === null || declarations === undefined) continue;
      for (const [name, headerLine] of declarations) {
        const definitions: Array<{ node: GraphNode; file: string; includeLine: number }> = [];
        for (const candidate of state.context.capture.scan.indexedFiles.filter((file) => file.language === "c" && /\.c$/i.test(file.normalizedPath))) {
          const candidateSource = sourceText(state.context, candidate.normalizedPath);
          if (candidateSource === null) continue;
          const candidateLines = linesOf(candidateSource);
          const matchingInclude = candidateLines.find((line) => includedPath(candidate.normalizedPath, line.text) === headerPath);
          const definition = candidateLines.find((line) => new RegExp(`^\\s*(?:[A-Za-z_]\\w*[\\s*&]+)+${name}\\s*\\([^;{}]*\\)\\s*\\{`).test(line.text));
          const target = definition === undefined ? undefined : declarationNode(state, candidate.normalizedPath, name, definition.number);
          if (matchingInclude !== undefined && target !== undefined) definitions.push({ node: target, file: candidate.normalizedPath, includeLine: matchingInclude.number });
        }
        if (definitions.length !== 1) continue;
        for (const callLine of lines) {
          if (!new RegExp(`\\b${name}\\s*\\(`).test(callLine.text)) continue;
          if (new RegExp(`^\\s*(?:[A-Za-z_]\\w*[\\s*&]+)+${name}\\s*\\([^;{}]*\\)\\s*\\{`).test(callLine.text)) continue;
          const caller = enclosingNode(state, scanned.normalizedPath, callLine.number);
          if (caller === undefined) continue;
          const definition = definitions[0]!;
          addEdge(state, makeEdge(caller, "calls", definition.node, [
            anchor(scanned.normalizedPath, includeLine.number), anchor(scanned.normalizedPath, callLine.number),
            anchor(headerPath, headerLine), anchor(definition.file, definition.node.lineStart ?? definition.includeLine)
          ], "parser-derived"));
        }
      }
    }
  }
}

function extractSubprocessBoundaries(state: State): void {
  for (const scanned of state.context.capture.scan.indexedFiles) {
    if (scanned.language !== "c" && scanned.language !== "cpp") continue;
    const source = sourceText(state.context, scanned.normalizedPath);
    if (source === null) continue;
    for (const line of linesOf(source)) {
      const reference = /\b(?:system|popen)\s*\(\s*["'](?:python(?:3(?:\.\d+)?)?|py)\s+([^\s"']+\.py)\b/.exec(line.text)?.[1];
      if (reference === undefined) continue;
      const repoRelative = reference.replace(/\\/g, "/").replace(/^\.\//, "");
      const sourceRelative = normalizePath(scanned.normalizedPath, reference);
      const candidates = [repoRelative, sourceRelative].filter((candidate): candidate is string =>
        candidate !== null && state.capturedPaths.has(candidate)
      );
      const targetPath = [...new Set(candidates)][0];
      if (targetPath === undefined) continue;
      const caller = enclosingNode(state, scanned.normalizedPath, line.number);
      const target = fileNode(state, targetPath);
      if (caller !== undefined && target !== undefined) addEdge(state, makeEdge(caller, "calls", target, [anchor(scanned.normalizedPath, line.number)], "parser-derived"));
    }
  }
}

function extractBuildLinks(state: State): void {
  const files = [...state.context.capture.scan.indexedFiles, ...state.context.capture.scan.supportFiles];
  for (const scanned of files.filter((file) => file.language === "cmake")) {
    const source = sourceText(state.context, scanned.normalizedPath);
    if (source === null) continue;
    const targets = new Map<string, GraphNode>();
    const lines = linesOf(source);
    for (const line of lines) {
      const name = /^\s*add_(?:library|executable|custom_target)\s*\(\s*([^\s)]+)/i.exec(line.text)?.[1];
      if (name === undefined) continue;
      const node = declarationNode(state, scanned.normalizedPath, name, line.number) ?? declarationNode(state, scanned.normalizedPath, name);
      if (node !== undefined) targets.set(name, node);
    }
    for (const line of lines) {
      const link = /^\s*target_link_libraries\s*\(\s*([^\s)]+)\s+(.+?)\s*\)\s*$/i.exec(line.text);
      if (link?.[1] === undefined || link[2] === undefined) continue;
      const sourceTarget = targets.get(link[1]);
      if (sourceTarget === undefined) continue;
      for (const dependency of link[2].split(/\s+/).filter((name) => !/^(?:PRIVATE|PUBLIC|INTERFACE|debug|optimized|general)$/i.test(name))) {
        const target = targets.get(dependency);
        if (target !== undefined) addEdge(state, makeEdge(sourceTarget, "references", target, [anchor(scanned.normalizedPath, line.number)], "repository-derived"));
      }
    }
  }
}

/** Resolve only cross-language boundaries carrying explicit, corroborated repository evidence. */
export function extractCrossLanguageBoundaries(
  context: ExtractionContext,
  nodes: readonly GraphNode[]
): ExtractorResult {
  const allFiles = [...context.capture.scan.indexedFiles, ...context.capture.scan.supportFiles];
  const state: State = {
    context,
    nodes,
    edges: new Map(),
    diagnostics: [],
    capturedPaths: new Set(allFiles.map((file) => file.normalizedPath))
  };
  extractHttpBoundaries(state);
  extractGeneratedBindings(state);
  extractFfiBoundaries(state);
  extractSubprocessBoundaries(state);
  extractBuildLinks(state);
  const result: ExtractorResult = {
    extractorId: EXTRACTOR_ID,
    extractorVersion: EXTRACTOR_VERSION,
    capability: "repository",
    languages: [...new Set(allFiles.map((file) => file.language))].sort(),
    nodes: [],
    edges: [...state.edges.values()].sort((left, right) => left.canonicalIdentity.localeCompare(right.canonicalIdentity)),
    projects: [],
    diagnostics: state.diagnostics
  };
  assertExtractorResult(result);
  return result;
}
