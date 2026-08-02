import path from "node:path";

import type { Evidence, NodeKind, Relation } from "@tadori/core";
import {
  edgeCanonicalIdentity,
  entityKey,
  nodeCanonicalIdentity,
  sha256Hex
} from "@tadori/core";
import {
  assertExtractorResult,
  provenance,
  type AttributedGraphEdge,
  type AttributedGraphNode,
  type DiscoveredProject,
  type ExtractionContext,
  type ExtractorResult,
  type RepositoryExtractor
} from "./extractorContract.js";
import type { LanguageId } from "./languageRegistry.js";

const EXTRACTOR_ID = "tadori-interface-files";
const EXTRACTOR_VERSION = "1";
const INTERFACE_LANGUAGES = [
  "protobuf", "terraform", "yaml", "dockerfile", "markdown", "json", "shell", "toml", "cmake"
] as const;
const INTERFACE_LANGUAGE_SET: ReadonlySet<string> = new Set(INTERFACE_LANGUAGES);

interface SourceLine {
  number: number;
  text: string;
  start: number;
  end: number;
}

interface ExtractionState {
  context: ExtractionContext;
  nodes: Map<string, AttributedGraphNode>;
  edges: Map<string, AttributedGraphEdge>;
  fileNodes: Map<string, AttributedGraphNode>;
  capturedPaths: Set<string>;
  languageByPath: Map<string, LanguageId>;
  diagnostics: ExtractorResult["diagnostics"];
}

function linesOf(source: string): SourceLine[] {
  const result: SourceLine[] = [];
  let offset = 0;
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? "";
    const start = Buffer.byteLength(source.slice(0, offset), "utf8");
    offset += text.length;
    const end = start + Buffer.byteLength(text, "utf8");
    result.push({ number: index + 1, text, start, end });
    if (source[offset] === "\r") offset += 1;
    if (source[offset] === "\n") offset += 1;
  }
  return result;
}

function anchor(file: string, line: SourceLine, kind: Evidence["kind"] = "source"): Evidence[] {
  return [{ file, kind, lineStart: line.number, lineEnd: line.number }];
}

function makeNode(
  language: LanguageId,
  file: string | null,
  kind: NodeKind,
  qualifiedName: string,
  displayName: string,
  evidence: Evidence[],
  options: {
    line?: SourceLine;
    signature?: string | null;
    bodyHash?: string | null;
    unresolvedReason?: string | null;
  } = {}
): AttributedGraphNode {
  const canonicalIdentity = nodeCanonicalIdentity(kind, qualifiedName);
  const line = options.line;
  return {
    kind,
    qualifiedName,
    displayName,
    canonicalIdentity,
    entityKey: entityKey(canonicalIdentity),
    file,
    exported: false,
    spanStart: line?.start ?? null,
    spanEnd: line?.end ?? null,
    lineStart: line?.number ?? null,
    lineEnd: line?.number ?? null,
    signature: options.signature ?? null,
    bodyHash: options.bodyHash ?? null,
    evidence,
    language,
    provenance: provenance(
      EXTRACTOR_ID,
      EXTRACTOR_VERSION,
      "repository",
      "repository-derived",
      options.unresolvedReason ?? null
    )
  };
}

function addNode(state: ExtractionState, node: AttributedGraphNode): AttributedGraphNode {
  const existing = state.nodes.get(node.canonicalIdentity);
  if (existing !== undefined) {
    const seen = new Set(existing.evidence.map((item) => JSON.stringify(item)));
    for (const item of node.evidence) if (!seen.has(JSON.stringify(item))) existing.evidence.push(item);
    existing.evidence.sort(compareEvidence);
    return existing;
  }
  state.nodes.set(node.canonicalIdentity, node);
  return node;
}

function compareEvidence(left: Evidence, right: Evidence): number {
  return left.file.localeCompare(right.file) || left.lineStart - right.lineStart || left.lineEnd - right.lineEnd;
}

function makeEdge(
  language: LanguageId,
  sourceKey: string,
  relation: Relation,
  targetKey: string,
  evidence: Evidence[],
  resolution: "resolved" | "partial" | "unresolved" = "resolved",
  unresolvedReason: string | null = null
): AttributedGraphEdge {
  const canonicalIdentity = edgeCanonicalIdentity(sourceKey, relation, targetKey);
  return {
    srcEntityKey: sourceKey,
    relation,
    dstEntityKey: targetKey,
    canonicalIdentity,
    entityKey: entityKey(canonicalIdentity),
    origin: "heuristic",
    confidence: resolution === "resolved" ? "certain" : resolution === "partial" ? "likely" : "inferred",
    resolution,
    evidence,
    language,
    provenance: provenance(
      EXTRACTOR_ID,
      EXTRACTOR_VERSION,
      "repository",
      "repository-derived",
      unresolvedReason
    )
  };
}

function addEdge(state: ExtractionState, edge: AttributedGraphEdge): void {
  const existing = state.edges.get(edge.canonicalIdentity);
  if (existing === undefined) {
    state.edges.set(edge.canonicalIdentity, edge);
    return;
  }
  const seen = new Set(existing.evidence.map((item) => JSON.stringify(item)));
  for (const item of edge.evidence) if (!seen.has(JSON.stringify(item))) existing.evidence.push(item);
  existing.evidence.sort(compareEvidence);
}

function addContained(
  state: ExtractionState,
  language: LanguageId,
  parent: AttributedGraphNode,
  child: AttributedGraphNode,
  evidence: Evidence[]
): void {
  addEdge(state, makeEdge(language, parent.entityKey, "contains", child.entityKey, evidence));
}

function fileNode(language: LanguageId, file: string, source: string): AttributedGraphNode {
  const count = Math.max(1, source.split(/\r?\n/).length);
  return makeNode(
    language,
    file,
    "file",
    file,
    path.posix.basename(file),
    [{ file, kind: "source", lineStart: 1, lineEnd: count }],
    { bodyHash: sha256Hex(source) }
  );
}

function externalNode(
  state: ExtractionState,
  language: LanguageId,
  scheme: string,
  value: string,
  evidence: Evidence[]
): AttributedGraphNode {
  return addNode(state, makeNode(
    language,
    null,
    "external_dep",
    `${language}:${scheme}:${value}`,
    value,
    evidence
  ));
}

function unresolvedNode(
  state: ExtractionState,
  language: LanguageId,
  file: string,
  value: string,
  line: SourceLine,
  reason: string
): AttributedGraphNode {
  return addNode(state, makeNode(
    language,
    file,
    "unresolved",
    `${language}:${file}::<unresolved:${value}@${line.start}>`,
    value,
    anchor(file, line),
    { line, unresolvedReason: reason }
  ));
}

function normalizeExplicitPath(sourceFile: string, raw: string): string | null {
  const cleaned = raw.trim().replace(/^['"]|['"]$/g, "").replace(/[?#].*$/, "").replace(/\\/g, "/");
  if (cleaned.length === 0 || cleaned.includes("${") || cleaned.includes("$(") || cleaned.includes("{{")) return null;
  const candidate = cleaned.startsWith("/")
    ? path.posix.normalize(cleaned.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), cleaned));
  return candidate === ".." || candidate.startsWith("../") ? null : candidate.replace(/^\.\//, "");
}

function addExplicitReference(
  state: ExtractionState,
  language: LanguageId,
  source: AttributedGraphNode,
  relation: "imports" | "references",
  raw: string,
  file: string,
  line: SourceLine,
  reason: string
): void {
  const evidence = anchor(file, line);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const target = externalNode(state, language, "uri", raw, evidence);
    addEdge(state, makeEdge(language, source.entityKey, relation, target.entityKey, evidence, "partial"));
    return;
  }
  const normalized = normalizeExplicitPath(file, raw);
  if (normalized !== null && state.capturedPaths.has(normalized)) {
    const targetLanguage = state.languageByPath.get(normalized);
    if (language === "markdown" && targetLanguage !== undefined && targetLanguage !== language) {
      const crossLanguageReason = "markdown-link-is-documentation-not-integration-evidence";
      const target = unresolvedNode(state, language, file, raw, line, crossLanguageReason);
      addEdge(state, makeEdge(
        language,
        source.entityKey,
        relation,
        target.entityKey,
        evidence,
        "unresolved",
        crossLanguageReason
      ));
      return;
    }
    const targetKey = entityKey(nodeCanonicalIdentity("file", normalized));
    addEdge(state, makeEdge(language, source.entityKey, relation, targetKey, evidence));
    return;
  }
  const target = unresolvedNode(state, language, file, raw, line, reason);
  addEdge(state, makeEdge(language, source.entityKey, relation, target.entityKey, evidence, "unresolved", reason));
}

function extractProtobuf(state: ExtractionState, file: string, source: string, root: AttributedGraphNode): void {
  let packageNode: AttributedGraphNode | null = null;
  let service: { node: AttributedGraphNode; depth: number } | null = null;
  let depth = 0;
  const messages = new Map<string, AttributedGraphNode>();
  const pendingRpcTypes: Array<{ rpc: AttributedGraphNode; name: string; line: SourceLine }> = [];
  for (const line of linesOf(source)) {
    const code = line.text.replace(/\/\/.*$/, "");
    const packageMatch = /^\s*package\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/.exec(code);
    if (packageMatch?.[1] !== undefined) {
      packageNode = addNode(state, makeNode("protobuf", file, "package", `protobuf:package:${packageMatch[1]}`, packageMatch[1], anchor(file, line), { line, signature: code.trim() }));
      addContained(state, "protobuf", root, packageNode, anchor(file, line));
    }
    const declaration = /^\s*(message|enum)\s+([A-Za-z_]\w*)\s*\{/.exec(code);
    if (declaration?.[1] !== undefined && declaration[2] !== undefined) {
      const prefix = packageNode?.displayName ?? file;
      const node = addNode(state, makeNode("protobuf", file, "type", `protobuf:${prefix}.${declaration[2]}`, declaration[2], anchor(file, line), { line, signature: code.trim() }));
      messages.set(declaration[2], node);
      addContained(state, "protobuf", packageNode ?? root, node, anchor(file, line));
    }
    const serviceMatch = /^\s*service\s+([A-Za-z_]\w*)\s*\{/.exec(code);
    if (serviceMatch?.[1] !== undefined) {
      const prefix = packageNode?.displayName ?? file;
      const node = addNode(state, makeNode("protobuf", file, "interface", `protobuf:${prefix}.${serviceMatch[1]}`, serviceMatch[1], anchor(file, line), { line, signature: code.trim() }));
      addContained(state, "protobuf", packageNode ?? root, node, anchor(file, line));
      service = { node, depth: depth + 1 };
    }
    const rpcMatch = /^\s*rpc\s+([A-Za-z_]\w*)\s*\(\s*(?:stream\s+)?([.A-Za-z_]\w*)\s*\)\s+returns\s*\(\s*(?:stream\s+)?([.A-Za-z_]\w*)\s*\)/.exec(code);
    if (rpcMatch?.[1] !== undefined && rpcMatch[2] !== undefined && rpcMatch[3] !== undefined && service !== null) {
      const rpc = addNode(state, makeNode("protobuf", file, "method", `${service.node.qualifiedName}.${rpcMatch[1]}`, rpcMatch[1], anchor(file, line), { line, signature: code.trim() }));
      addContained(state, "protobuf", service.node, rpc, anchor(file, line));
      pendingRpcTypes.push({ rpc, name: rpcMatch[2].split(".").at(-1) ?? rpcMatch[2], line });
      pendingRpcTypes.push({ rpc, name: rpcMatch[3].split(".").at(-1) ?? rpcMatch[3], line });
    }
    const importMatch = /^\s*import\s+(?:public\s+|weak\s+)?["']([^"']+)["']\s*;/.exec(code);
    if (importMatch?.[1] !== undefined) addExplicitReference(state, "protobuf", root, "imports", importMatch[1], file, line, "protobuf-import-target-not-captured");
    depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
    if (service !== null && depth < service.depth) service = null;
  }
  for (const pending of pendingRpcTypes) {
    const target = messages.get(pending.name);
    if (target !== undefined) addEdge(state, makeEdge("protobuf", pending.rpc.entityKey, "references", target.entityKey, anchor(file, pending.line)));
    else {
      const unresolved = unresolvedNode(state, "protobuf", file, pending.name, pending.line, "protobuf-rpc-type-not-declared-in-file");
      addEdge(state, makeEdge("protobuf", pending.rpc.entityKey, "references", unresolved.entityKey, anchor(file, pending.line), "unresolved", "protobuf-rpc-type-not-declared-in-file"));
    }
  }
  if (depth !== 0) state.diagnostics.push({ code: "interface-protobuf-unbalanced-braces", severity: "warning", message: "Protocol Buffers braces are unbalanced; independently recognized facts were retained", file, language: "protobuf", extractorId: EXTRACTOR_ID });
  if (/\b[A-Za-z_]\w*\s*=\s*;/.test(source)) state.diagnostics.push({ code: "interface-protobuf-invalid-field", severity: "warning", message: "Protocol Buffers contains an incomplete field declaration; independently recognized facts were retained", file, language: "protobuf", extractorId: EXTRACTOR_ID });
}

function extractMarkdown(state: ExtractionState, file: string, source: string, root: AttributedGraphNode): void {
  const stack: Array<{ level: number; node: AttributedGraphNode }> = [];
  for (const line of linesOf(source)) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line.text);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      const level = heading[1].length;
      while ((stack.at(-1)?.level ?? 0) >= level) stack.pop();
      const slug = heading[2].trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
      const node = addNode(state, makeNode("markdown", file, "doc_section", `markdown:${file}#${slug || `line-${line.number}`}`, heading[2].trim(), anchor(file, line, "documentation"), { line, signature: line.text.trim() }));
      addContained(state, "markdown", stack.at(-1)?.node ?? root, node, anchor(file, line, "documentation"));
      stack.push({ level, node });
    }
    for (const match of line.text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      if (target === undefined || target.startsWith("#")) continue;
      addExplicitReference(state, "markdown", stack.at(-1)?.node ?? root, "references", target, file, line, "markdown-link-target-not-captured");
    }
  }
}

function extractTerraform(state: ExtractionState, file: string, source: string, root: AttributedGraphNode): void {
  let module: AttributedGraphNode | null = null;
  let moduleDepth = 0;
  let depth = 0;
  for (const line of linesOf(source)) {
    const block = /^\s*(resource|data|module|variable|output|provider|terraform)\s*(?:"([^"]+)")?\s*(?:"([^"]+)")?\s*\{/.exec(line.text);
    if (block?.[1] !== undefined) {
      const labels = [block[2], block[3]].filter((value): value is string => value !== undefined);
      const display = labels.length > 0 ? `${block[1]}.${labels.join(".")}` : block[1];
      const node = addNode(state, makeNode("terraform", file, "type", `terraform:${file}::${display}`, display, anchor(file, line), { line, signature: line.text.trim() }));
      addContained(state, "terraform", root, node, anchor(file, line));
      if (block[1] === "module") { module = node; moduleDepth = depth + 1; }
    }
    const sourceMatch = /^\s*source\s*=\s*["']([^"']+)["']/.exec(line.text);
    if (sourceMatch?.[1] !== undefined && module !== null) {
      const value = sourceMatch[1];
      if (value.startsWith("./") || value.startsWith("../") || value.startsWith("/")) addExplicitReference(state, "terraform", module, "imports", value, file, line, "terraform-module-source-not-captured");
      else {
        const target = externalNode(state, "terraform", "module", value, anchor(file, line));
        addEdge(state, makeEdge("terraform", module.entityKey, "imports", target.entityKey, anchor(file, line), "partial"));
      }
    }
    depth += (line.text.match(/\{/g) ?? []).length - (line.text.match(/\}/g) ?? []).length;
    if (module !== null && depth < moduleDepth) module = null;
  }
  const openingBrackets = (source.match(/\[/g) ?? []).length;
  const closingBrackets = (source.match(/\]/g) ?? []).length;
  if (depth !== 0 || openingBrackets !== closingBrackets) state.diagnostics.push({ code: "interface-terraform-unbalanced-delimiters", severity: "warning", message: "Terraform delimiters are unbalanced; independently recognized facts were retained", file, language: "terraform", extractorId: EXTRACTOR_ID });
}

function addCommand(state: ExtractionState, language: LanguageId, sourceNode: AttributedGraphNode, commandText: string, file: string, line: SourceLine): void {
  const command = /^(?:\s*(?:sudo|env|command|exec)\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*([A-Za-z0-9_.+/-]+)/.exec(commandText.trim())?.[1];
  if (command === undefined || new Set(["if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case", "esac", "function", "return", "export", "local", "set", "cd"]).has(command)) return;
  const target = externalNode(state, language, "subprocess", command, anchor(file, line));
  addEdge(state, makeEdge(language, sourceNode.entityKey, "calls", target.entityKey, anchor(file, line), "partial"));
}

function extractShell(state: ExtractionState, file: string, source: string, root: AttributedGraphNode): void {
  let active: AttributedGraphNode | null = null;
  let depth = 0;
  for (const line of linesOf(source)) {
    const functionMatch = /^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*\))?\s*\{/.exec(line.text);
    if (functionMatch?.[1] !== undefined) {
      active = addNode(state, makeNode("shell", file, "function", `shell:${file}::${functionMatch[1]}`, functionMatch[1], anchor(file, line), { line, signature: line.text.trim() }));
      addContained(state, "shell", root, active, anchor(file, line));
      depth = 1;
      continue;
    }
    const sourceMatch = /^\s*(?:source|\.)\s+(["']?[^\s"']+["']?)/.exec(line.text);
    if (sourceMatch?.[1] !== undefined) addExplicitReference(state, "shell", active ?? root, "imports", sourceMatch[1], file, line, "shell-source-target-not-captured");
    const trimmed = line.text.trim();
    if (trimmed !== "" && !trimmed.startsWith("#") && sourceMatch === null) addCommand(state, "shell", active ?? root, trimmed, file, line);
    if (active !== null) {
      depth += (line.text.match(/\{/g) ?? []).length - (line.text.match(/\}/g) ?? []).length;
      if (depth <= 0) active = null;
    }
  }
}

function extractDockerfile(state: ExtractionState, file: string, source: string, root: AttributedGraphNode): void {
  for (const line of linesOf(source)) {
    const from = /^\s*FROM(?:\s+--platform=\S+)?\s+(\S+)/i.exec(line.text)?.[1];
    if (from !== undefined) {
      const target = externalNode(state, "dockerfile", "image", from, anchor(file, line));
      addEdge(state, makeEdge("dockerfile", root.entityKey, "imports", target.entityKey, anchor(file, line), "partial"));
    }
    const copy = /^\s*(?:COPY|ADD)(?:\s+--\S+)*\s+(?:\[\s*)?["']?([^\s,"']+)/i.exec(line.text)?.[1];
    if (copy !== undefined && !copy.startsWith("--from=")) addExplicitReference(state, "dockerfile", root, "references", copy, file, line, "docker-build-context-path-not-captured");
    const run = /^\s*RUN\s+(.+)$/i.exec(line.text)?.[1];
    if (run !== undefined && !run.trimStart().startsWith("[")) addCommand(state, "dockerfile", root, run, file, line);
  }
}

function extractCmake(state: ExtractionState, file: string, source: string, root: AttributedGraphNode): void {
  for (const line of linesOf(source)) {
    const targetMatch = /^\s*(add_executable|add_library|add_custom_target)\s*\(\s*([^\s)]+)/i.exec(line.text);
    if (targetMatch?.[2] !== undefined) {
      const node = addNode(state, makeNode("cmake", file, "type", `cmake:${file}::target:${targetMatch[2]}`, targetMatch[2], anchor(file, line), { line, signature: line.text.trim() }));
      addContained(state, "cmake", root, node, anchor(file, line));
    }
    const include = /^\s*(?:include|add_subdirectory)\s*\(\s*["']?([^\s)"']+)/i.exec(line.text)?.[1];
    if (include !== undefined && (include.includes("/") || /\.(?:cmake|txt)$/i.test(include))) addExplicitReference(state, "cmake", root, "imports", include, file, line, "cmake-include-target-not-captured");
    const command = /^\s*execute_process\s*\(.*\bCOMMAND\s+([^\s)]+)/i.exec(line.text)?.[1];
    if (command !== undefined) addCommand(state, "cmake", root, command, file, line);
  }
}

function extractMake(state: ExtractionState, file: string, source: string, root: AttributedGraphNode): void {
  let target: AttributedGraphNode | null = null;
  for (const line of linesOf(source)) {
    const declaration = /^([^\s:#=][^:#=]*):(?!=)(.*)$/.exec(line.text);
    if (declaration?.[1] !== undefined) {
      const name = declaration[1].trim();
      target = addNode(state, makeNode("shell", file, "type", `make:${file}::target:${name}`, name, anchor(file, line), { line, signature: line.text.trim() }));
      addContained(state, "shell", root, target, anchor(file, line));
      for (const dependency of (declaration[2] ?? "").trim().split(/\s+/).filter(Boolean)) {
        if (dependency.includes("/") || dependency.includes(".")) addExplicitReference(state, "shell", target, "references", dependency, file, line, "make-prerequisite-not-captured");
      }
    } else if (/^\t/.test(line.text) && target !== null) addCommand(state, "shell", target, line.text, file, line);
    else if (line.text.trim() !== "" && !line.text.trimStart().startsWith("#")) target = null;
  }
}

function extractConfigReferences(state: ExtractionState, language: "json" | "yaml" | "toml", file: string, source: string, root: AttributedGraphNode): void {
  if (language === "json") {
    try { JSON.parse(source) as unknown; }
    catch (error) {
      state.diagnostics.push({ code: "interface-json-invalid", severity: "warning", message: error instanceof Error ? error.message : String(error), file, language, extractorId: EXTRACTOR_ID });
      return;
    }
  }
  if (language === "yaml" && (source.match(/\[/g) ?? []).length !== (source.match(/\]/g) ?? []).length) {
    state.diagnostics.push({ code: "interface-yaml-unbalanced-flow-sequence", severity: "warning", message: "YAML flow-sequence delimiters are unbalanced; independently recognized facts were retained", file, language, extractorId: EXTRACTOR_ID });
  }
  const pathKey = /(?:path|file|extends|include|schema|config|workspace|source)/i;
  for (const line of linesOf(source)) {
    let key: string | undefined;
    let value: string | undefined;
    if (language === "json") {
      const match = /^\s*"([^"]+)"\s*:\s*"([^"]+)"/.exec(line.text);
      key = match?.[1]; value = match?.[2];
    } else if (language === "yaml") {
      const match = /^\s*([A-Za-z0-9_.-]+)\s*:\s*["']?([^#"']+?)["']?\s*$/.exec(line.text);
      key = match?.[1]; value = match?.[2]?.trim();
    } else {
      const match = /^\s*([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/.exec(line.text);
      key = match?.[1]; value = match?.[2];
    }
    if (key !== undefined && value !== undefined && pathKey.test(key) && (value.includes("/") || /^\.?\.?\//.test(value) || /\.[A-Za-z0-9]+$/.test(value))) {
      addExplicitReference(state, language, root, "references", value, file, line, `${language}-explicit-path-not-captured`);
    }
  }
}

function projectName(manifest: string, source: string): string | null {
  if (path.posix.basename(manifest) === "package.json") {
    try {
      const value = (JSON.parse(source) as { name?: unknown }).name;
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch { return null; }
  }
  const match = /^\s*(?:name|project)\s*(?:=|:)\s*["']?([^\s"'#]+)/im.exec(source);
  return match?.[1] ?? null;
}

function discoverProjects(context: ExtractionContext): DiscoveredProject[] {
  const captured = [...context.capture.scan.indexedFiles, ...context.capture.scan.supportFiles]
    .sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));
  const projects: DiscoveredProject[] = [];
  for (const file of captured) {
    const basename = path.posix.basename(file.normalizedPath);
    const languages = [...context.registrations.values()]
      .filter((registration) => registration.projectManifests.some((candidate) => candidate === basename || candidate === file.normalizedPath))
      .map((registration) => registration.id)
      .sort();
    if (languages.length === 0) continue;
    const root = path.posix.dirname(file.normalizedPath) === "." ? "." : path.posix.dirname(file.normalizedPath);
    const bytes = context.capture.fileContents.get(file.normalizedPath);
    projects.push({
      projectId: sha256Hex(`project|manifest|${file.normalizedPath}`),
      root,
      manifest: file.normalizedPath,
      kind: "manifest",
      name: bytes === undefined ? null : projectName(file.normalizedPath, bytes.toString("utf8")),
      languages
    });
  }
  return projects.sort((left, right) => left.projectId.localeCompare(right.projectId));
}

export const interfaceExtractor: RepositoryExtractor = {
  id: EXTRACTOR_ID,
  version: EXTRACTOR_VERSION,
  capability: "repository",
  languages: INTERFACE_LANGUAGES,
  extract(context: ExtractionContext): ExtractorResult {
    const state: ExtractionState = {
      context,
      nodes: new Map(),
      edges: new Map(),
      fileNodes: new Map(),
      // Only indexed files become snapshot members. Support manifests remain
      // available to project discovery, but references to them must stay
      // unresolved instead of fabricating an endpoint absent from the graph.
      capturedPaths: new Set(context.capture.scan.indexedFiles.map((file) => file.normalizedPath)),
      languageByPath: new Map(
        context.capture.scan.indexedFiles.map((file) => [file.normalizedPath, file.language])
      ),
      diagnostics: []
    };
    const extractableFiles = [
      ...context.capture.scan.indexedFiles,
      ...context.capture.scan.supportFiles.filter((file) => file.language === "cmake" || file.language === "shell")
    ];
    for (const scanned of extractableFiles.sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath))) {
      if (!INTERFACE_LANGUAGE_SET.has(scanned.language)) continue;
      const bytes = context.capture.fileContents.get(scanned.normalizedPath);
      if (bytes === undefined) {
        state.diagnostics.push({ code: "interface-source-missing", severity: "error", message: "Captured source bytes are unavailable", file: scanned.normalizedPath, language: scanned.language, extractorId: EXTRACTOR_ID });
        continue;
      }
      const source = bytes.toString("utf8");
      const root = addNode(state, fileNode(scanned.language, scanned.normalizedPath, source));
      state.fileNodes.set(scanned.normalizedPath, root);
      try {
        switch (scanned.language) {
          case "protobuf": extractProtobuf(state, scanned.normalizedPath, source, root); break;
          case "markdown": extractMarkdown(state, scanned.normalizedPath, source, root); break;
          case "terraform": extractTerraform(state, scanned.normalizedPath, source, root); break;
          case "dockerfile": extractDockerfile(state, scanned.normalizedPath, source, root); break;
          case "shell":
            if (path.posix.basename(scanned.normalizedPath).toLowerCase() === "makefile") {
              extractMake(state, scanned.normalizedPath, source, root);
            } else {
              extractShell(state, scanned.normalizedPath, source, root);
            }
            break;
          case "cmake": extractCmake(state, scanned.normalizedPath, source, root); break;
          case "json": case "yaml": case "toml": extractConfigReferences(state, scanned.language, scanned.normalizedPath, source, root); break;
        }
      } catch (error) {
        state.diagnostics.push({ code: "interface-file-extraction-failed", severity: "error", message: error instanceof Error ? error.message : String(error), file: scanned.normalizedPath, language: scanned.language, extractorId: EXTRACTOR_ID });
      }
    }
    const result: ExtractorResult = {
      extractorId: EXTRACTOR_ID,
      extractorVersion: EXTRACTOR_VERSION,
      capability: "repository",
      languages: [...INTERFACE_LANGUAGES],
      nodes: [...state.nodes.values()].sort((left, right) => left.canonicalIdentity.localeCompare(right.canonicalIdentity)),
      edges: [...state.edges.values()].sort((left, right) => left.canonicalIdentity.localeCompare(right.canonicalIdentity)),
      projects: discoverProjects(context),
      diagnostics: state.diagnostics.sort((left, right) => (left.file ?? "").localeCompare(right.file ?? "") || left.code.localeCompare(right.code))
    };
    assertExtractorResult(result);
    return result;
  }
};
