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
  type ExtractionContext,
  type ExtractorResult,
  type RepositoryExtractor
} from "./extractorContract.js";
import type { LanguageId, LanguageRegistration } from "./languageRegistry.js";
import {
  parseStructuralSourceSync,
  type StructuralSyntaxNode
} from "./treeSitterRuntime.js";

const EXTRACTOR_ID = "tadori-tree-sitter";
const EXTRACTOR_VERSION = "1";
const STRUCTURAL_LANGUAGES = ["python", "c", "cpp", "go", "rust", "java"] as const;

interface LanguageShape {
  declarations: Readonly<Record<string, NodeKind>>;
  imports: ReadonlySet<string>;
  calls: ReadonlySet<string>;
  inheritanceFields: readonly string[];
}

const SHAPES: Readonly<Record<(typeof STRUCTURAL_LANGUAGES)[number], LanguageShape>> = {
  python: {
    declarations: { function_definition: "function", class_definition: "class" },
    imports: new Set(["import_statement", "import_from_statement"]),
    calls: new Set(["call"]),
    inheritanceFields: ["superclasses"]
  },
  c: {
    declarations: {
      function_definition: "function", struct_specifier: "type", enum_specifier: "type",
      union_specifier: "type", type_definition: "type"
    },
    imports: new Set(["preproc_include"]),
    calls: new Set(["call_expression"]),
    inheritanceFields: []
  },
  cpp: {
    declarations: {
      function_definition: "function", class_specifier: "class", struct_specifier: "type",
      enum_specifier: "type", type_definition: "type"
    },
    imports: new Set(["preproc_include", "using_declaration"]),
    calls: new Set(["call_expression"]),
    inheritanceFields: ["bases"]
  },
  go: {
    declarations: {
      function_declaration: "function", method_declaration: "method", type_spec: "type"
    },
    imports: new Set(["import_declaration", "import_spec"]),
    calls: new Set(["call_expression"]),
    inheritanceFields: []
  },
  rust: {
    declarations: {
      function_item: "function", struct_item: "type", enum_item: "type", trait_item: "interface"
    },
    imports: new Set(["use_declaration", "extern_crate_declaration"]),
    calls: new Set(["call_expression"]),
    inheritanceFields: ["trait"]
  },
  java: {
    declarations: {
      method_declaration: "method", constructor_declaration: "method", class_declaration: "class",
      interface_declaration: "interface", enum_declaration: "type", record_declaration: "type"
    },
    imports: new Set(["import_declaration"]),
    calls: new Set(["method_invocation", "object_creation_expression"]),
    inheritanceFields: ["superclass", "interfaces"]
  }
};

interface PendingCall {
  caller: AttributedGraphNode;
  name: string;
  node: StructuralSyntaxNode;
}

interface PendingInheritance {
  source: AttributedGraphNode;
  name: string;
  node: StructuralSyntaxNode;
  relation: "extends" | "implements";
}

interface PendingRustImplementation {
  file: string;
  language: LanguageId;
  sourceName: string;
  targetName: string;
  node: StructuralSyntaxNode;
}

function isStructuralLanguage(language: LanguageId): language is keyof typeof SHAPES {
  return Object.prototype.hasOwnProperty.call(SHAPES, language);
}

function utf8Slice(sourceBytes: Buffer, node: StructuralSyntaxNode): string {
  return sourceBytes.subarray(node.startIndex, node.endIndex).toString("utf8");
}

function field(node: StructuralSyntaxNode, ...names: string[]): StructuralSyntaxNode | null {
  for (const name of names) {
    const child = node.children.find((candidate) => candidate.fieldName === name);
    if (child !== undefined) return child;
  }
  return null;
}

function descendants(node: StructuralSyntaxNode): StructuralSyntaxNode[] {
  const result: StructuralSyntaxNode[] = [];
  const visit = (current: StructuralSyntaxNode): void => {
    result.push(current);
    for (const child of current.children) visit(child);
  };
  visit(node);
  return result;
}

function identifierText(source: Buffer, node: StructuralSyntaxNode | null): string | null {
  if (node === null) return null;
  const candidates = descendants(node).filter((candidate) =>
    candidate.children.length === 0 &&
    /(?:identifier|name|type_identifier|field_identifier)$/.test(candidate.type)
  );
  const selected = candidates.at(-1) ?? (node.children.length === 0 ? node : null);
  const text = selected === null ? "" : utf8Slice(source, selected).trim();
  return text.length > 0 ? text : null;
}

function declarationName(source: Buffer, node: StructuralSyntaxNode): string | null {
  const direct = identifierText(source, field(node, "name"));
  if (direct !== null) return direct;
  let declarator = field(node, "declarator", "type");
  if (declarator === null) return identifierText(source, node);
  for (;;) {
    const nested = field(declarator, "declarator");
    if (nested === null) break;
    declarator = nested;
  }
  return identifierText(source, declarator);
}

function evidence(file: string, node: StructuralSyntaxNode): Evidence[] {
  return [{
    file,
    kind: "source",
    lineStart: node.startRow + 1,
    lineEnd: node.endRow + 1,
    columnStart: node.startColumn + 1,
    columnEnd: node.endColumn + 1
  }];
}

function structuralFingerprint(source: Buffer, node: StructuralSyntaxNode): string {
  const encode = (current: StructuralSyntaxNode): string => {
    if (current.children.length === 0) {
      return `${current.type}:${utf8Slice(source, current).replace(/\s+/g, " ").trim()}`;
    }
    return `${current.type}(${current.children.filter((child) => child.type !== "comment").map(encode).join(",")})`;
  };
  return sha256Hex(encode(node));
}

function makeNode(
  language: LanguageId,
  file: string,
  kind: NodeKind,
  qualifiedName: string,
  displayName: string,
  source: Buffer,
  syntax: StructuralSyntaxNode,
  signature: string | null = null
): AttributedGraphNode {
  const canonicalIdentity = nodeCanonicalIdentity(kind, qualifiedName);
  return {
    kind,
    qualifiedName,
    displayName,
    canonicalIdentity,
    entityKey: entityKey(canonicalIdentity),
    file,
    exported: false,
    spanStart: syntax.startIndex,
    spanEnd: syntax.endIndex,
    lineStart: syntax.startRow + 1,
    lineEnd: syntax.endRow + 1,
    signature,
    bodyHash: structuralFingerprint(source, syntax),
    evidence: evidence(file, syntax),
    language,
    provenance: provenance(EXTRACTOR_ID, EXTRACTOR_VERSION, "structural", "parser-derived")
  };
}

function makeEdge(
  language: LanguageId,
  source: AttributedGraphNode,
  relation: Relation,
  target: AttributedGraphNode,
  anchors: Evidence[],
  resolution: "resolved" | "partial" | "unresolved" = "resolved",
  unresolvedReason: string | null = null
): AttributedGraphEdge {
  const canonicalIdentity = edgeCanonicalIdentity(source.entityKey, relation, target.entityKey);
  return {
    srcEntityKey: source.entityKey,
    relation,
    dstEntityKey: target.entityKey,
    canonicalIdentity,
    entityKey: entityKey(canonicalIdentity),
    origin: "heuristic",
    confidence: resolution === "resolved" ? "likely" : "inferred",
    resolution,
    evidence: anchors,
    language,
    provenance: provenance(
      EXTRACTOR_ID,
      EXTRACTOR_VERSION,
      "structural",
      "parser-derived",
      unresolvedReason
    )
  };
}

function fileNode(
  language: LanguageId,
  file: string,
  source: Buffer,
  root: StructuralSyntaxNode
): AttributedGraphNode {
  const node = makeNode(
    language,
    file,
    "file",
    file,
    path.posix.basename(file),
    source,
    root
  );
  return { ...node, bodyHash: sha256Hex(source.toString("utf8")) };
}

function externalDependencyNode(
  language: LanguageId,
  specifier: string,
  file: string,
  syntax: StructuralSyntaxNode
): AttributedGraphNode {
  const qualifiedName = `${language}:module:${specifier}`;
  const canonicalIdentity = nodeCanonicalIdentity("external_dep", qualifiedName);
  return {
    kind: "external_dep",
    qualifiedName,
    displayName: specifier,
    canonicalIdentity,
    entityKey: entityKey(canonicalIdentity),
    file: null,
    exported: false,
    spanStart: null,
    spanEnd: null,
    lineStart: null,
    lineEnd: null,
    signature: null,
    bodyHash: null,
    evidence: evidence(file, syntax),
    language,
    provenance: provenance(EXTRACTOR_ID, EXTRACTOR_VERSION, "structural", "parser-derived")
  };
}

function isTestSymbol(language: LanguageId, file: string, name: string, text: string): boolean {
  if (language === "python") return name.startsWith("test_") || /(?:^|\/)test_[^/]+\.py$/.test(file);
  if (language === "c" || language === "cpp") {
    return /(?:^|\/)(?:test[^/]*|[^/]*[_.-]test[^/]*)\.(?:c|cc|cpp|cxx)$/i.test(file);
  }
  if (language === "go") return name.startsWith("Test") && file.endsWith("_test.go");
  if (language === "rust") return /#\s*\[\s*test\s*\]/.test(text) || file.includes("/tests/");
  if (language === "java") return /@Test\b/.test(text) || /Test\.java$/.test(file);
  return /(?:^|[_.])test(?:[_.]|$)/i.test(file) && /test/i.test(name);
}

function importSpecifier(text: string): string {
  return text
    .replace(/^\s*(?:#\s*include|import|from|use|using|extern\s+crate)\s+/, "")
    .replace(/\s+(?:import|as)\s+.*$/, "")
    .replace(/[;"'<>]/g, "")
    .trim();
}

function callName(source: Buffer, node: StructuralSyntaxNode): string | null {
  const named = field(node, "function", "name", "type");
  return identifierText(source, named ?? node.children[0] ?? null);
}

function declarationQualifiedName(
  language: LanguageId,
  file: string,
  packageName: string | null,
  container: readonly string[],
  name: string
): string {
  if (language === "cpp" && container.length > 0) {
    return [...container, name].join("::");
  }
  if (language === "java") {
    return [...(packageName === null ? [] : [packageName]), ...container, name].join(".");
  }
  const containerName = container.join(".");
  return `${language}:${file}::${containerName.length > 0 ? `${containerName}.` : ""}${name}`;
}

function dynamicCallReason(
  language: LanguageId,
  source: Buffer,
  pending: PendingCall
): string | null {
  const callText = utf8Slice(source, pending.node).replace(/\s+/g, " ").trim();
  const callerText = source
    .subarray(pending.caller.spanStart ?? 0, pending.caller.spanEnd ?? 0)
    .toString("utf8");

  if (language === "python" && /^getattr\s*\([\s\S]*\)\s*\(.*\)$/.test(callText)) {
    return "dynamic-import-reflection";
  }
  if (
    (language === "c" || language === "cpp") &&
    /^callback\s*\(/.test(callText) &&
    /(?:\(\s*\*\s*callback\s*\)|\bCallback\s+callback\b)/.test(callerText)
  ) {
    return "indirect-function-pointer";
  }
  if (language === "go" && /^[A-Za-z_]\w*\s*\[[^\]]+\]\s*\(/.test(callText)) {
    return "dynamic-map-dispatch";
  }
  if (
    language === "rust" &&
    /^callback\s*\(/.test(callText) &&
    /\bHashMap\b/.test(callerText) &&
    /\.get\s*\(/.test(callerText)
  ) {
    return "dynamic-map-dispatch";
  }
  if (language === "java" && /\.invoke\s*\(/.test(callText) && /\bMethod\b/.test(callerText)) {
    return "reflection";
  }
  return null;
}

function addUniqueNode(
  nodes: Map<string, AttributedGraphNode>,
  node: AttributedGraphNode
): AttributedGraphNode {
  const existing = nodes.get(node.canonicalIdentity);
  if (existing !== undefined) return existing;
  nodes.set(node.canonicalIdentity, node);
  return node;
}

function addUniqueEdge(edges: Map<string, AttributedGraphEdge>, edge: AttributedGraphEdge): void {
  const existing = edges.get(edge.canonicalIdentity);
  if (existing === undefined) {
    edges.set(edge.canonicalIdentity, edge);
  } else {
    const evidenceKeys = new Set(existing.evidence.map((item) => JSON.stringify(item)));
    for (const item of edge.evidence) {
      if (!evidenceKeys.has(JSON.stringify(item))) existing.evidence.push(item);
    }
    existing.evidence.sort((left, right) =>
      left.file.localeCompare(right.file) || left.lineStart - right.lineStart || left.lineEnd - right.lineEnd
    );
  }
}

function unresolvedNode(
  language: LanguageId,
  file: string,
  label: string,
  source: Buffer,
  syntax: StructuralSyntaxNode,
  reason: string,
  nodes: Map<string, AttributedGraphNode>
): AttributedGraphNode {
  const qualifiedName = `${language}:${file}::<unresolved:${label}@${syntax.startIndex}>`;
  const node = makeNode(language, file, "unresolved", qualifiedName, label, source, syntax);
  node.provenance = provenance(EXTRACTOR_ID, EXTRACTOR_VERSION, "structural", "parser-derived", reason);
  return addUniqueNode(nodes, node);
}

export const structuralExtractor: RepositoryExtractor = {
  id: EXTRACTOR_ID,
  version: EXTRACTOR_VERSION,
  capability: "structural",
  languages: STRUCTURAL_LANGUAGES,
  extract(context: ExtractionContext): ExtractorResult {
    const nodes = new Map<string, AttributedGraphNode>();
    const edges = new Map<string, AttributedGraphEdge>();
    const diagnostics: ExtractorResult["diagnostics"] = [];
    const symbolsByName = new Map<string, AttributedGraphNode[]>();
    const calls: PendingCall[] = [];
    const inheritance: PendingInheritance[] = [];
    const rustImplementations: PendingRustImplementation[] = [];

    for (const scanned of context.capture.scan.indexedFiles) {
      if (!isStructuralLanguage(scanned.language)) continue;
      const registration: LanguageRegistration | undefined = context.registrations.get(scanned.language);
      if (registration === undefined) {
        diagnostics.push({
          code: "structural-registration-missing", severity: "error",
          message: `No registry entry for structural language ${scanned.language}`,
          file: scanned.normalizedPath, language: scanned.language, extractorId: EXTRACTOR_ID
        });
        continue;
      }
      const bytes = context.capture.fileContents.get(scanned.normalizedPath);
      if (bytes === undefined) {
        diagnostics.push({
          code: "structural-source-missing", severity: "error",
          message: "Captured source bytes are unavailable", file: scanned.normalizedPath,
          language: scanned.language, extractorId: EXTRACTOR_ID
        });
        continue;
      }

      try {
        const parsed = parseStructuralSourceSync(registration, bytes.toString("utf8"));
        const shape = SHAPES[scanned.language];
        const packageName = scanned.language === "java"
          ? /^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m.exec(bytes.toString("utf8"))?.[1] ?? null
          : null;
        const sourceFileNode = addUniqueNode(nodes, fileNode(scanned.language, scanned.normalizedPath, bytes, parsed.root));
        const importOffsets = new Set<number>();

        const visit = (
          syntax: StructuralSyntaxNode,
          container: readonly string[],
          currentSymbol: AttributedGraphNode | null
        ): void => {
          let nextContainer = container;
          let nextSymbol = currentSymbol;
          if (scanned.language === "cpp" && syntax.type === "namespace_definition") {
            const namespaceName = identifierText(bytes, field(syntax, "name"));
            if (namespaceName !== null) nextContainer = [...container, namespaceName];
          }
          if (scanned.language === "rust" && syntax.type === "impl_item") {
            const implementedTypeNode = field(syntax, "type");
            const implementedType = identifierText(bytes, implementedTypeNode);
            if (implementedType !== null) nextContainer = [...container, implementedType];
            const traitNode = field(syntax, "trait");
            const traitName = identifierText(bytes, traitNode);
            if (implementedType !== null && traitNode !== null && traitName !== null) {
              rustImplementations.push({
                file: scanned.normalizedPath,
                language: scanned.language,
                sourceName: implementedType,
                targetName: traitName,
                node: traitNode
              });
            }
          }
          const configuredKind = shape.declarations[syntax.type];
          if (configuredKind !== undefined) {
            const name = declarationName(bytes, syntax);
            if (name !== null) {
              let kind = configuredKind;
              if (
                kind === "function" && container.length > 0 &&
                !(scanned.language === "cpp" && currentSymbol === null)
              ) kind = "method";
              const declarationText = utf8Slice(bytes, syntax);
              if ((kind === "function" || kind === "method") && isTestSymbol(scanned.language, scanned.normalizedPath, name, declarationText)) {
                kind = "test";
              }
              const baseQualifiedName = declarationQualifiedName(
                scanned.language,
                scanned.normalizedPath,
                packageName,
                container,
                name
              );
              let qualifiedName = baseQualifiedName;
              let collision = 2;
              while (nodes.has(nodeCanonicalIdentity(kind, qualifiedName))) {
                qualifiedName = `${baseQualifiedName}#${String(collision)}`;
                collision += 1;
              }
              const firstLine = declarationText.split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim() ?? null;
              const symbol = addUniqueNode(nodes, makeNode(
                scanned.language, scanned.normalizedPath, kind, qualifiedName, name, bytes, syntax, firstLine
              ));
              const bucket = symbolsByName.get(name) ?? [];
              bucket.push(symbol);
              symbolsByName.set(name, bucket);
              addUniqueEdge(edges, makeEdge(
                scanned.language, currentSymbol ?? sourceFileNode, "contains", symbol, evidence(scanned.normalizedPath, syntax)
              ));
              nextSymbol = symbol;
              if (kind === "class" || kind === "interface" || kind === "type") nextContainer = [...container, name];

              for (const inheritanceField of shape.inheritanceFields) {
                const inherited = field(syntax, inheritanceField);
                if (inherited === null) continue;
                for (const candidate of descendants(inherited)) {
                  if (!/(?:identifier|type_identifier|scoped_type_identifier)$/.test(candidate.type)) continue;
                  const targetName = utf8Slice(bytes, candidate).trim();
                  if (targetName.length === 0) continue;
                  inheritance.push({
                    source: symbol,
                    name: targetName,
                    node: candidate,
                    relation: inheritanceField === "interfaces" || inheritanceField === "trait" ? "implements" : "extends"
                  });
                }
              }
              if (scanned.language === "cpp") {
                const bases = syntax.children.find((child) => child.type === "base_class_clause");
                if (bases !== undefined) {
                  for (const candidate of descendants(bases)) {
                    if (!/(?:identifier|type_identifier|qualified_identifier)$/.test(candidate.type)) continue;
                    const targetName = identifierText(bytes, candidate);
                    if (targetName !== null) {
                      inheritance.push({ source: symbol, name: targetName, node: candidate, relation: "extends" });
                    }
                  }
                }
              }
            }
          }

          if (shape.imports.has(syntax.type) && !importOffsets.has(syntax.startIndex)) {
            importOffsets.add(syntax.startIndex);
            const specifier = importSpecifier(utf8Slice(bytes, syntax));
            if (specifier.length > 0) {
              const external = addUniqueNode(
                nodes,
                externalDependencyNode(scanned.language, specifier, scanned.normalizedPath, syntax)
              );
              addUniqueEdge(edges, makeEdge(
                scanned.language, sourceFileNode, "imports", external, evidence(scanned.normalizedPath, syntax), "partial"
              ));
            }
          }

          if (nextSymbol !== null && shape.calls.has(syntax.type)) {
            const name = callName(bytes, syntax);
            if (name !== null) calls.push({ caller: nextSymbol, name, node: syntax });
          }
          for (const child of syntax.children) visit(child, nextContainer, nextSymbol);
        };
        visit(parsed.root, [], null);
        const cPlusPlusCompatibilityHeader =
          scanned.language === "c" && /\.h$/i.test(scanned.normalizedPath) &&
          /^\s*#\s*ifn?def\s+__cplusplus\b/m.test(bytes.toString("utf8"));
        if (parsed.hasErrors && !cPlusPlusCompatibilityHeader) {
          diagnostics.push({
            code: "structural-syntax-recovery", severity: "warning",
            message: "Tree-sitter recovered from syntax errors; unaffected structural facts were retained",
            file: scanned.normalizedPath, language: scanned.language, extractorId: EXTRACTOR_ID
          });
        }
      } catch (error) {
        diagnostics.push({
          code: "structural-parse-failed", severity: "error",
          message: error instanceof Error ? error.message : String(error),
          file: scanned.normalizedPath, language: scanned.language, extractorId: EXTRACTOR_ID
        });
      }
    }

    for (const implementation of rustImplementations) {
      const source = (symbolsByName.get(implementation.sourceName) ?? []).find((candidate) =>
        candidate.file === implementation.file &&
        (candidate.kind === "class" || candidate.kind === "interface" || candidate.kind === "type")
      );
      if (source !== undefined) {
        inheritance.push({
          source,
          name: implementation.targetName,
          node: implementation.node,
          relation: "implements"
        });
      }
    }

    for (const pending of calls) {
      const targets = (symbolsByName.get(pending.name) ?? []).filter((target) => target.file === pending.caller.file);
      const anchor = evidence(pending.caller.file ?? "unknown", pending.node);
      const bytes = context.capture.fileContents.get(pending.caller.file ?? "");
      const classifiedReason = bytes === undefined
        ? null
        : dynamicCallReason(pending.caller.language ?? "unknown", bytes, pending);
      if (classifiedReason === null && targets.length === 1) {
        const relation = pending.caller.kind === "test" ? "tests" : "calls";
        addUniqueEdge(edges, makeEdge(pending.caller.language ?? "unknown", pending.caller, relation, targets[0]!, anchor));
      } else {
        if (bytes === undefined || pending.caller.file === null) continue;
        const reason = classifiedReason ?? (targets.length === 0
          ? "no-local-structural-target"
          : "ambiguous-local-structural-target");
        const target = unresolvedNode(
          pending.caller.language ?? "unknown", pending.caller.file, pending.name, bytes, pending.node, reason, nodes
        );
        addUniqueEdge(edges, makeEdge(
          pending.caller.language ?? "unknown", pending.caller, "calls", target, anchor, "unresolved",
          reason
        ));
      }
    }

    for (const pending of inheritance) {
      const targets = (symbolsByName.get(pending.name) ?? []).filter((target) =>
        target.language === pending.source.language &&
        (target.kind === "class" || target.kind === "interface" || target.kind === "type")
      );
      const file = pending.source.file;
      if (targets.length === 1) {
        addUniqueEdge(edges, makeEdge(
          pending.source.language ?? "unknown", pending.source, pending.relation, targets[0]!,
          evidence(file ?? "unknown", pending.node)
        ));
      } else if (file !== null) {
        const bytes = context.capture.fileContents.get(file);
        if (bytes === undefined) continue;
        const reason = targets.length === 0
          ? "no-structural-inheritance-target"
          : "ambiguous-structural-inheritance-target";
        const target = unresolvedNode(
          pending.source.language ?? "unknown", file, pending.name, bytes, pending.node, reason, nodes
        );
        addUniqueEdge(edges, makeEdge(
          pending.source.language ?? "unknown", pending.source, pending.relation, target,
          evidence(file, pending.node), "unresolved",
          reason
        ));
      }
    }

    const result: ExtractorResult = {
      extractorId: EXTRACTOR_ID,
      extractorVersion: EXTRACTOR_VERSION,
      capability: "structural",
      languages: [...STRUCTURAL_LANGUAGES],
      nodes: [...nodes.values()].sort((left, right) => left.canonicalIdentity.localeCompare(right.canonicalIdentity)),
      edges: [...edges.values()].sort((left, right) => left.canonicalIdentity.localeCompare(right.canonicalIdentity)),
      projects: [],
      diagnostics: diagnostics.sort((left, right) =>
        (left.file ?? "").localeCompare(right.file ?? "") || left.code.localeCompare(right.code)
      )
    };
    assertExtractorResult(result);
    return result;
  }
};
