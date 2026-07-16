import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type {
  Evidence,
  GraphEdge,
  GraphFile,
  GraphNode,
  NodeKind,
  Relation
} from "@tadori/core";
import {
  edgeCanonicalIdentity,
  entityKey,
  fileCanonicalIdentity,
  nodeCanonicalIdentity,
  sha256Hex,
  sha256HexBytes
} from "@tadori/core";
import type { ProjectServices } from "./project.js";
import type { ScanResult, ScannedFile } from "./scan.js";
import { detectPackageName, normalizePath } from "./scan.js";
import {
  backtickTerms,
  COMPILER_CERTAIN,
  dynamicCallLabel,
  EXPRESS_ROUTE_METHODS,
  findAdrHeading,
  HTTP_VERB_NAMES,
  isExpressReceiver,
  isPathTerm,
  metadataScore,
  nextRouteRole,
  unwrapExpression,
  type EdgeMetadata
} from "./semantics.js";

export interface IndexDiagnostic {
  file: string | null;
  message: string;
}

export interface ExtractedGraph {
  packageName: string;
  files: GraphFile[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  diagnostics: IndexDiagnostic[];
}

/**
 * Body hash recipe (implementation-defined; the frozen documents specify only
 * that a body hash exists): SHA-256 of the declaration text (all declarations
 * of the logical entity joined with newlines) with every whitespace run
 * collapsed to a single space. Whitespace-only edits keep the hash stable;
 * renaming a self-referencing symbol changes it, which is exactly the
 * documented Stage-B coalescing limitation.
 */
export function bodyHashOfText(declarationText: string): string {
  return sha256Hex(declarationText.replace(/\s+/g, " ").trim());
}

function lineCountOf(text: string): number {
  if (text.length === 0) {
    return 1;
  }
  const lines = text.split("\n");
  return Math.max(1, lines.length - (lines.at(-1) === "" ? 1 : 0));
}

interface NodeBuilderOptions {
  kind: NodeKind;
  qualifiedName: string;
  displayName: string;
  file: string | null;
  exported: boolean;
  spanStart?: number | null;
  spanEnd?: number | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  signature?: string | null;
  bodyHash?: string | null;
  evidence?: Evidence[];
}

function buildNode(options: NodeBuilderOptions): GraphNode {
  const canonical = nodeCanonicalIdentity(options.kind, options.qualifiedName);
  return {
    kind: options.kind,
    qualifiedName: options.qualifiedName,
    displayName: options.displayName,
    canonicalIdentity: canonical,
    entityKey: entityKey(canonical),
    file: options.file,
    exported: options.exported,
    spanStart: options.spanStart ?? null,
    spanEnd: options.spanEnd ?? null,
    lineStart: options.lineStart ?? null,
    lineEnd: options.lineEnd ?? null,
    signature: options.signature ?? null,
    bodyHash: options.bodyHash ?? null,
    evidence: options.evidence ?? []
  };
}

class EdgeCollector {
  private readonly edges = new Map<string, GraphEdge>();

  add(
    src: GraphNode,
    relation: Relation,
    dst: GraphNode,
    evidence: Evidence[],
    metadata: EdgeMetadata = COMPILER_CERTAIN
  ): void {
    const canonical = edgeCanonicalIdentity(src.entityKey, relation, dst.entityKey);
    const existing = this.edges.get(canonical);
    if (existing) {
      existing.evidence.push(...evidence);
      // Duplicate stable edges merge evidence; the stronger provenance claim
      // wins deterministically (never downgrade an already-stronger edge).
      if (
        metadataScore(metadata) >
        metadataScore({
          origin: existing.origin,
          confidence: existing.confidence,
          resolution: existing.resolution
        })
      ) {
        existing.origin = metadata.origin;
        existing.confidence = metadata.confidence;
        existing.resolution = metadata.resolution;
      }
      return;
    }
    this.edges.set(canonical, {
      srcEntityKey: src.entityKey,
      relation,
      dstEntityKey: dst.entityKey,
      canonicalIdentity: canonical,
      entityKey: entityKey(canonical),
      origin: metadata.origin,
      confidence: metadata.confidence,
      resolution: metadata.resolution,
      evidence
    });
  }

  all(): GraphEdge[] {
    return [...this.edges.values()].sort((a, b) =>
      a.canonicalIdentity.localeCompare(b.canonicalIdentity)
    );
  }
}

type DeclarationLike =
  | ts.FunctionDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration;

function isExportedDeclaration(decl: DeclarationLike): boolean {
  const flags = ts.getCombinedModifierFlags(decl);
  return (flags & ts.ModifierFlags.Export) !== 0 || (flags & ts.ModifierFlags.Default) !== 0;
}

interface SymbolRegistration {
  node: GraphNode;
  declarations: ts.Node[];
}

export function extractGraph(
  root: string,
  scan: ScanResult,
  services: ProjectServices
): ExtractedGraph {
  const { program, checker, compilerOptions } = services;
  const diagnostics: IndexDiagnostic[] = [];

  // ---- files and file nodes -------------------------------------------------
  const files: GraphFile[] = [];
  const fileNodes = new Map<string, GraphNode>();
  const fileTexts = new Map<string, string>();

  for (const scanned of scan.indexedFiles) {
    const bytes = readFileSync(scanned.absolutePath);
    const text = bytes.toString("utf8");
    fileTexts.set(scanned.normalizedPath, text);
    files.push({
      path: scanned.normalizedPath,
      normalizedPath: scanned.normalizedPath,
      originIdentity: fileCanonicalIdentity(scanned.normalizedPath),
      fileKey: entityKey(fileCanonicalIdentity(scanned.normalizedPath)),
      packageName: detectPackageName(root, scanned.absolutePath),
      language: scanned.language,
      contentHash: sha256HexBytes(bytes),
      sizeBytes: bytes.length,
      isGenerated: false,
      isBinary: false
    });
    const lineCount = lineCountOf(text);
    fileNodes.set(
      scanned.normalizedPath,
      buildNode({
        kind: "file",
        qualifiedName: scanned.normalizedPath,
        displayName: path.posix.basename(scanned.normalizedPath),
        file: scanned.normalizedPath,
        exported: false,
        spanStart: 0,
        spanEnd: text.length,
        lineStart: 1,
        lineEnd: lineCount,
        bodyHash: sha256HexBytes(bytes),
        evidence: [
          { file: scanned.normalizedPath, kind: "source", lineStart: 1, lineEnd: lineCount }
        ]
      })
    );
  }

  // ---- package node ----------------------------------------------------------
  const rootPackageName = detectPackageName(root, path.join(root, "package.json"));
  const packageName = rootPackageName ?? path.basename(root);
  if (rootPackageName === null) {
    diagnostics.push({
      file: null,
      message: `No root package.json name found; using directory name ${JSON.stringify(packageName)} as the package qualified name.`
    });
  }
  const packageNode = buildNode({
    kind: "package",
    qualifiedName: packageName,
    displayName: packageName,
    file: null,
    exported: false
  });

  const edges = new EdgeCollector();
  for (const [normalizedPath, fileNode] of fileNodes) {
    edges.add(packageNode, "contains", fileNode, [
      { file: normalizedPath, kind: "source", lineStart: 1, lineEnd: 1 }
    ]);
  }

  // ---- symbol extraction (pass 1) --------------------------------------------
  const symbolNodes: GraphNode[] = [];
  const externalNodes = new Map<string, GraphNode>();
  /** `${normalizedPath}|${topLevelName}` or `${path}|${Class}.${member}` -> registration */
  const registry = new Map<string, SymbolRegistration>();

  const sourceFileFor = (scanned: ScannedFile): ts.SourceFile | undefined =>
    program.getSourceFile(path.resolve(scanned.absolutePath).replace(/\\/g, "/")) ??
    program.getSourceFile(path.resolve(scanned.absolutePath));

  const registerSymbol = (
    key: string,
    node: GraphNode,
    declarations: ts.Node[]
  ): void => {
    if (registry.has(key)) {
      diagnostics.push({
        file: node.file,
        message: `Duplicate symbol registration for ${key}; keeping the first occurrence.`
      });
      return;
    }
    registry.set(key, { node, declarations });
    symbolNodes.push(node);
  };

  const lineRangeOf = (
    sf: ts.SourceFile,
    start: number,
    end: number
  ): { lineStart: number; lineEnd: number } => ({
    lineStart: sf.getLineAndCharacterOfPosition(start).line + 1,
    lineEnd: sf.getLineAndCharacterOfPosition(end).line + 1
  });

  const signatureOf = (sf: ts.SourceFile, decl: ts.Node): string => {
    if (
      (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl)) &&
      decl.body !== undefined
    ) {
      return sf.text
        .slice(decl.getStart(sf), decl.body.getStart(sf))
        .replace(/\{\s*$/, "")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (ts.isMethodSignature(decl) || ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl)) {
      return decl.getText(sf).replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
    }
    if (ts.isPropertyDeclaration(decl) && decl.name !== undefined) {
      return decl.name.getText(sf);
    }
    if (ts.isClassDeclaration(decl) && decl.name) {
      return `class ${decl.name.text}`;
    }
    if (ts.isInterfaceDeclaration(decl)) {
      return `interface ${decl.name.text}`;
    }
    if (ts.isTypeAliasDeclaration(decl)) {
      return `type ${decl.name.text}`;
    }
    return decl.getText(sf).split("\n")[0]?.trim() ?? "";
  };

  const extractMembers = (
    sf: ts.SourceFile,
    normalizedPath: string,
    containerName: string,
    containerNode: GraphNode,
    members: ts.NodeArray<ts.ClassElement> | ts.NodeArray<ts.TypeElement>
  ): void => {
    for (const member of members) {
      let isMethodLike = false;
      if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
        isMethodLike = true;
      } else if (
        ts.isPropertyDeclaration(member) &&
        member.initializer !== undefined &&
        (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
      ) {
        // Function-valued class properties used as handlers are method nodes
        // (golden fixture contract §2).
        isMethodLike = true;
      }
      if (!isMethodLike) {
        continue;
      }
      const name = member.name;
      if (name === undefined || !ts.isIdentifier(name)) {
        diagnostics.push({
          file: normalizedPath,
          message: `Skipped computed or unnamed member in ${containerName}.`
        });
        continue;
      }
      const start = member.getStart(sf);
      const end = member.getEnd();
      const qualifiedName = `${normalizedPath}.${containerName}.${name.text}`;
      const node = buildNode({
        kind: "method",
        qualifiedName,
        displayName: name.text,
        file: normalizedPath,
        exported: false,
        spanStart: start,
        spanEnd: end,
        ...lineRangeOf(sf, start, end),
        signature: signatureOf(sf, member),
        bodyHash: bodyHashOfText(member.getText(sf)),
        evidence: [
          { file: normalizedPath, kind: "source", ...linesAsEvidence(sf, start, end) }
        ]
      });
      registerSymbol(`${normalizedPath}|${containerName}.${name.text}`, node, [member]);

      const fileNode = fileNodes.get(normalizedPath);
      if (fileNode) {
        edges.add(fileNode, "contains", node, [
          { file: normalizedPath, kind: "source", ...linesAsEvidence(sf, start, end) }
        ]);
      }
      edges.add(containerNode, "contains", node, [
        { file: normalizedPath, kind: "source", ...linesAsEvidence(sf, start, end) }
      ]);
    }
  };

  const linesAsEvidence = (
    sf: ts.SourceFile,
    start: number,
    end: number
  ): { lineStart: number; lineEnd: number } => lineRangeOf(sf, start, end);

  const processedFunctionSymbols = new Set<ts.Symbol>();

  for (const scanned of scan.indexedFiles) {
    if (scanned.language === "markdown") {
      continue;
    }
    const sf = sourceFileFor(scanned);
    if (!sf) {
      diagnostics.push({
        file: scanned.normalizedPath,
        message:
          "File is not part of the TypeScript program (e.g. JavaScript without allowJs); indexed as a file node only."
      });
      continue;
    }
    const normalizedPath = scanned.normalizedPath;
    const fileNode = fileNodes.get(normalizedPath);
    if (!fileNode) {
      continue;
    }

    for (const statement of sf.statements) {
      if (ts.isFunctionDeclaration(statement)) {
        if ((ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Ambient) !== 0) {
          // `declare function ...` describes an external; it defines nothing here.
          continue;
        }
        if (!statement.name) {
          diagnostics.push({
            file: normalizedPath,
            message: "Skipped unnamed default-exported function declaration."
          });
          continue;
        }
        const symbol = checker.getSymbolAtLocation(statement.name);
        if (symbol && processedFunctionSymbols.has(symbol)) {
          continue; // Overload declaration already collapsed into one node.
        }
        if (symbol) {
          processedFunctionSymbols.add(symbol);
        }
        const group: ts.FunctionDeclaration[] =
          symbol?.declarations?.filter(
            (d): d is ts.FunctionDeclaration =>
              ts.isFunctionDeclaration(d) && d.getSourceFile() === sf
          ) ?? [statement];
        const start = Math.min(...group.map((d) => d.getStart(sf)));
        const end = Math.max(...group.map((d) => d.getEnd()));
        const implementation = group.find((d) => d.body !== undefined) ?? statement;
        const name = statement.name.text;
        const node = buildNode({
          kind: "function",
          qualifiedName: `${normalizedPath}.${name}`,
          displayName: name,
          file: normalizedPath,
          exported: group.some((d) => isExportedDeclaration(d)),
          spanStart: start,
          spanEnd: end,
          ...lineRangeOf(sf, start, end),
          signature: signatureOf(sf, implementation),
          bodyHash: bodyHashOfText(group.map((d) => d.getText(sf)).join("\n")),
          evidence: [{ file: normalizedPath, kind: "source", ...linesAsEvidence(sf, start, end) }]
        });
        registerSymbol(`${normalizedPath}|${name}`, node, [...group]);
        edges.add(fileNode, "contains", node, [
          { file: normalizedPath, kind: "source", ...linesAsEvidence(sf, start, end) }
        ]);
        if (node.exported) {
          edges.add(fileNode, "exports", node, [
            { file: normalizedPath, kind: "source", ...linesAsEvidence(sf, start, end) }
          ]);
        }
        continue;
      }

      if (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
        if (!statement.name) {
          diagnostics.push({
            file: normalizedPath,
            message: "Skipped unnamed class declaration."
          });
          continue;
        }
        const kind: NodeKind = ts.isClassDeclaration(statement) ? "class" : "interface";
        const start = statement.getStart(sf);
        const end = statement.getEnd();
        const name = statement.name.text;
        const node = buildNode({
          kind,
          qualifiedName: `${normalizedPath}.${name}`,
          displayName: name,
          file: normalizedPath,
          exported: isExportedDeclaration(statement),
          spanStart: start,
          spanEnd: end,
          ...lineRangeOf(sf, start, end),
          signature: signatureOf(sf, statement),
          bodyHash: bodyHashOfText(statement.getText(sf)),
          evidence: [{ file: normalizedPath, kind: "source", ...linesAsEvidence(sf, start, end) }]
        });
        registerSymbol(`${normalizedPath}|${name}`, node, [statement]);
        edges.add(fileNode, "contains", node, [
          { file: normalizedPath, kind: "source", ...linesAsEvidence(sf, start, end) }
        ]);
        if (node.exported) {
          edges.add(fileNode, "exports", node, [
            { file: normalizedPath, kind: "source", ...linesAsEvidence(sf, start, end) }
          ]);
        }
        extractMembers(sf, normalizedPath, name, node, statement.members);
        continue;
      }

      if (ts.isTypeAliasDeclaration(statement)) {
        const start = statement.getStart(sf);
        const end = statement.getEnd();
        const name = statement.name.text;
        const node = buildNode({
          kind: "type",
          qualifiedName: `${normalizedPath}.${name}`,
          displayName: name,
          file: normalizedPath,
          exported: isExportedDeclaration(statement),
          spanStart: start,
          spanEnd: end,
          ...lineRangeOf(sf, start, end),
          signature: signatureOf(sf, statement),
          bodyHash: bodyHashOfText(statement.getText(sf)),
          evidence: [{ file: normalizedPath, kind: "source", ...linesAsEvidence(sf, start, end) }]
        });
        registerSymbol(`${normalizedPath}|${name}`, node, [statement]);
        edges.add(fileNode, "contains", node, [
          { file: normalizedPath, kind: "source", ...linesAsEvidence(sf, start, end) }
        ]);
        if (node.exported) {
          edges.add(fileNode, "exports", node, [
            { file: normalizedPath, kind: "source", ...linesAsEvidence(sf, start, end) }
          ]);
        }
        continue;
      }

      // Variable declarations are deliberately not nodes (fixture contract §2),
      // so exported consts emit neither nodes nor exports edges.
    }
  }

  // ---- imports and re-export edges (pass 2) -----------------------------------
  const externalDepNode = (specifier: string): GraphNode => {
    const existing = externalNodes.get(specifier);
    if (existing) {
      return existing;
    }
    const node = buildNode({
      kind: "external_dep",
      qualifiedName: `npm:${specifier}`,
      displayName: specifier,
      file: null,
      exported: false
    });
    externalNodes.set(specifier, node);
    return node;
  };

  const resolveRelativeTarget = (
    specifier: string,
    containingAbsolute: string
  ): string | null => {
    const resolved = ts.resolveModuleName(
      specifier,
      containingAbsolute,
      compilerOptions,
      ts.sys
    ).resolvedModule;
    if (!resolved) {
      return null;
    }
    return normalizePath(root, path.resolve(resolved.resolvedFileName));
  };

  const nodeForDeclaration = (decl: ts.Node): GraphNode | null => {
    const declSf = decl.getSourceFile();
    let normalized: string;
    try {
      normalized = normalizePath(root, path.resolve(declSf.fileName));
    } catch {
      return null;
    }
    if (ts.isFunctionDeclaration(decl) || ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl)) {
      const name = decl.name?.text;
      if (!name) {
        return null;
      }
      return registry.get(`${normalized}|${name}`)?.node ?? null;
    }
    if (
      ts.isMethodDeclaration(decl) ||
      ts.isMethodSignature(decl) ||
      ts.isPropertyDeclaration(decl)
    ) {
      // Members registered as method nodes (only function-valued properties
      // were registered, so plain data properties miss the registry and stay null).
      const container = decl.parent;
      if (
        (ts.isClassDeclaration(container) || ts.isInterfaceDeclaration(container)) &&
        container.name !== undefined &&
        decl.name !== undefined &&
        ts.isIdentifier(decl.name)
      ) {
        return registry.get(`${normalized}|${container.name.text}.${decl.name.text}`)?.node ?? null;
      }
    }
    return null;
  };

  const resolveAliasedSymbol = (symbol: ts.Symbol): ts.Symbol => {
    let current = symbol;
    let guard = 0;
    while ((current.flags & ts.SymbolFlags.Alias) !== 0 && guard < 32) {
      const next = checker.getAliasedSymbol(current);
      if (next === current) {
        break;
      }
      current = next;
      guard += 1;
    }
    return current;
  };

  /** Graph node a symbol's (alias-resolved) declarations define, if any. */
  const graphNodeForSymbol = (symbol: ts.Symbol | undefined): GraphNode | null => {
    if (!symbol) {
      return null;
    }
    for (const decl of resolveAliasedSymbol(symbol).declarations ?? []) {
      const node = nodeForDeclaration(decl);
      if (node) {
        return node;
      }
    }
    return null;
  };

  const resolveExportTarget = (specifierName: ts.ModuleExportName): GraphNode | null => {
    let symbol = checker.getSymbolAtLocation(specifierName);
    if (!symbol) {
      return null;
    }
    let guard = 0;
    while ((symbol.flags & ts.SymbolFlags.Alias) !== 0 && guard < 32) {
      const next = checker.getAliasedSymbol(symbol);
      if (next === symbol) {
        break;
      }
      symbol = next;
      guard += 1;
    }
    for (const decl of symbol.declarations ?? []) {
      const node = nodeForDeclaration(decl);
      if (node) {
        return node;
      }
    }
    return null;
  };

  for (const scanned of scan.indexedFiles) {
    if (scanned.language === "markdown") {
      continue;
    }
    const sf = sourceFileFor(scanned);
    if (!sf) {
      continue;
    }
    const normalizedPath = scanned.normalizedPath;
    const fileNode = fileNodes.get(normalizedPath);
    if (!fileNode) {
      continue;
    }
    const containingAbsolute = path.resolve(scanned.absolutePath);

    for (const statement of sf.statements) {
      const isImport = ts.isImportDeclaration(statement);
      const isExportFrom = ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined;
      const isLocalExportList =
        ts.isExportDeclaration(statement) && statement.moduleSpecifier === undefined;

      if (!isImport && !isExportFrom && !isLocalExportList) {
        continue;
      }

      const statementEvidence: Evidence = {
        file: normalizedPath,
        kind: "source",
        ...linesAsEvidence(sf, statement.getStart(sf), statement.getEnd())
      };

      if (isImport || isExportFrom) {
        const moduleSpecifier = (statement as ts.ImportDeclaration | ts.ExportDeclaration)
          .moduleSpecifier;
        if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) {
          diagnostics.push({
            file: normalizedPath,
            message: "Skipped import/export with a non-literal module specifier."
          });
          continue;
        }
        const specifier = moduleSpecifier.text;
        if (specifier.startsWith(".")) {
          const targetPath = resolveRelativeTarget(specifier, containingAbsolute);
          const targetNode = targetPath ? fileNodes.get(targetPath) : undefined;
          if (!targetNode) {
            diagnostics.push({
              file: normalizedPath,
              message: `Relative import ${JSON.stringify(specifier)} did not resolve to an indexed file${targetPath ? ` (resolved to ${targetPath})` : ""}; no imports edge emitted.`
            });
          } else {
            edges.add(fileNode, "imports", targetNode, [statementEvidence]);
          }
        } else {
          edges.add(fileNode, "imports", externalDepNode(specifier), [statementEvidence]);
        }
      }

      if (ts.isExportDeclaration(statement)) {
        const clause = statement.exportClause;
        if (clause && ts.isNamedExports(clause)) {
          for (const specifier of clause.elements) {
            const target = resolveExportTarget(specifier.name);
            if (!target) {
              diagnostics.push({
                file: normalizedPath,
                message: `Export specifier ${specifier.name.text} did not resolve to a graph symbol node (variables and external targets are excluded); no exports edge emitted.`
              });
              continue;
            }
            if (isLocalExportList && target.file === normalizedPath) {
              target.exported = true;
            }
            edges.add(fileNode, "exports", target, [statementEvidence]);
          }
        } else if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          // `export * from "..."`: enumerate the module's exports.
          const moduleSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
          if (!moduleSymbol) {
            diagnostics.push({
              file: normalizedPath,
              message: `Star re-export of ${statement.moduleSpecifier.text} could not be resolved.`
            });
            continue;
          }
          for (const exported of checker.getExportsOfModule(moduleSymbol)) {
            let symbol = exported;
            let guard = 0;
            while ((symbol.flags & ts.SymbolFlags.Alias) !== 0 && guard < 32) {
              const next = checker.getAliasedSymbol(symbol);
              if (next === symbol) {
                break;
              }
              symbol = next;
              guard += 1;
            }
            const target = (symbol.declarations ?? [])
              .map((d) => nodeForDeclaration(d))
              .find((n): n is GraphNode => n !== null);
            if (target) {
              edges.add(fileNode, "exports", target, [statementEvidence]);
            }
          }
        }
      }
    }
  }

  // ---- Week 3 shared indexes ---------------------------------------------------
  interface SpanEntry {
    start: number;
    end: number;
    node: GraphNode;
  }
  const spansByFile = new Map<string, SpanEntry[]>();
  for (const { node } of registry.values()) {
    if (node.file !== null && node.spanStart !== null && node.spanEnd !== null) {
      const entries = spansByFile.get(node.file) ?? [];
      entries.push({ start: node.spanStart, end: node.spanEnd, node });
      spansByFile.set(node.file, entries);
    }
  }

  /** Innermost registered symbol whose span contains the position. */
  const enclosingNode = (
    file: string,
    pos: number,
    kinds: readonly NodeKind[]
  ): GraphNode | null => {
    let best: SpanEntry | null = null;
    for (const entry of spansByFile.get(file) ?? []) {
      if (entry.start <= pos && pos < entry.end && kinds.includes(entry.node.kind)) {
        if (best === null || entry.end - entry.start < best.end - best.start) {
          best = entry;
        }
      }
    }
    return best?.node ?? null;
  };

  const symbolsByDisplayName = new Map<string, GraphNode[]>();
  for (const node of symbolNodes) {
    const list = symbolsByDisplayName.get(node.displayName) ?? [];
    list.push(node);
    symbolsByDisplayName.set(node.displayName, list);
  }

  const lineEvidence = (sf: ts.SourceFile, node: ts.Node, p: string): Evidence => ({
    file: p,
    kind: "source",
    ...linesAsEvidence(sf, node.getStart(sf), node.getEnd())
  });

  // ---- pass 3: heritage (implements / extends) ---------------------------------
  for (const { node, declarations } of registry.values()) {
    if (node.kind !== "class" && node.kind !== "interface") {
      continue;
    }
    for (const decl of declarations) {
      if (!(ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl))) {
        continue;
      }
      const sf = decl.getSourceFile();
      for (const clause of decl.heritageClauses ?? []) {
        const relation: Relation =
          clause.token === ts.SyntaxKind.ImplementsKeyword ? "implements" : "extends";
        for (const typeExpr of clause.types) {
          const expr = unwrapExpression(typeExpr.expression);
          const nameNode = ts.isPropertyAccessExpression(expr) ? expr.name : expr;
          const target = graphNodeForSymbol(checker.getSymbolAtLocation(nameNode));
          if (!target || node.file === null) {
            diagnostics.push({
              file: node.file,
              message: `Heritage clause ${typeExpr.getText(sf)} on ${node.displayName} did not resolve to a graph node; no ${relation} edge emitted.`
            });
            continue;
          }
          edges.add(node, relation, target, [lineEvidence(sf, typeExpr, node.file)]);
        }
      }
    }
  }

  // ---- pass 4: ADR nodes and documents links ------------------------------------
  const adrNodes: GraphNode[] = [];
  for (const scanned of scan.indexedFiles) {
    if (scanned.language !== "markdown") {
      continue;
    }
    const p = scanned.normalizedPath;
    const fileNode = fileNodes.get(p);
    const text = fileTexts.get(p);
    if (!fileNode || text === undefined) {
      continue;
    }
    const docLines = text.split("\n");
    const heading = findAdrHeading(docLines);
    if (!heading) {
      diagnostics.push({
        file: p,
        message: "Markdown file has no ADR-<n> H1 heading; indexed as a file node only."
      });
      continue;
    }
    const adrNode = buildNode({
      kind: "adr",
      qualifiedName: `${p}::${heading.adrId}`,
      displayName: heading.title,
      file: p,
      exported: false,
      lineStart: heading.line,
      lineEnd: heading.line,
      evidence: [{ file: p, kind: "source", lineStart: heading.line, lineEnd: heading.line }]
    });
    adrNodes.push(adrNode);
    edges.add(fileNode, "contains", adrNode, [
      { file: p, kind: "source", lineStart: heading.line, lineEnd: heading.line }
    ]);

    for (let i = 0; i < docLines.length; i += 1) {
      const docLine = docLines[i];
      if (docLine === undefined) {
        continue;
      }
      // Precision-first doc linking: at most one documents edge per line (the
      // first resolving term anchors the sentence; see IMPLEMENTATION_STATUS.md).
      let lineLinked = false;
      for (const term of backtickTerms(docLine)) {
        if (lineLinked) {
          break;
        }
        const evidence: Evidence[] = [
          { file: p, kind: "documentation", lineStart: i + 1, lineEnd: i + 1 }
        ];
        if (isPathTerm(term)) {
          const target = fileNodes.get(term);
          if (target) {
            edges.add(adrNode, "documents", target, evidence, {
              origin: "doc",
              confidence: "certain",
              resolution: "resolved"
            });
            lineLinked = true;
          } else {
            diagnostics.push({
              file: p,
              message: `Doc path link ${JSON.stringify(term)} does not resolve to an indexed file; no documents edge.`
            });
          }
          continue;
        }
        if (HTTP_VERB_NAMES.has(term)) {
          diagnostics.push({
            file: p,
            message: `Doc symbol link ${JSON.stringify(term)} is a generic route-handler name; excluded from unique-symbol linking.`
          });
          continue;
        }
        const matches = symbolsByDisplayName.get(term) ?? [];
        if (matches.length === 1 && matches[0] !== undefined) {
          edges.add(adrNode, "documents", matches[0], evidence, {
            origin: "doc",
            confidence: "likely",
            resolution: "resolved"
          });
          lineLinked = true;
        } else if (matches.length > 1) {
          diagnostics.push({
            file: p,
            message: `Doc symbol link ${JSON.stringify(term)} is ambiguous (${matches.length} candidates); no documents edge.`
          });
        }
      }
    }
  }

  // ---- pass 5: test nodes, tests edges, and test spans ---------------------------
  const testNodes: GraphNode[] = [];
  const testIntervalsByFile = new Map<string, Array<{ start: number; end: number }>>();
  const registeredTests = new Set<string>();
  for (const scanned of scan.indexedFiles) {
    if (scanned.language === "markdown") {
      continue;
    }
    const sf = sourceFileFor(scanned);
    const p = scanned.normalizedPath;
    const fileNode = fileNodes.get(p);
    if (!sf || !fileNode) {
      continue;
    }
    for (const statement of sf.statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
        continue;
      }
      const call = statement.expression;
      if (!ts.isIdentifier(call.expression)) {
        continue;
      }
      if (call.expression.text !== "test" && call.expression.text !== "it") {
        continue;
      }
      const titleArg = call.arguments[0];
      const callbackArg = call.arguments[1];
      if (
        titleArg === undefined ||
        !ts.isStringLiteralLike(titleArg) ||
        callbackArg === undefined ||
        !(ts.isArrowFunction(callbackArg) || ts.isFunctionExpression(callbackArg))
      ) {
        continue;
      }
      const qualifiedName = `${p}::${titleArg.text}`;
      if (registeredTests.has(qualifiedName)) {
        diagnostics.push({
          file: p,
          message: `Duplicate test title ${JSON.stringify(titleArg.text)}; keeping the first occurrence.`
        });
        continue;
      }
      registeredTests.add(qualifiedName);
      const start = call.getStart(sf);
      const end = call.getEnd();
      const testNode = buildNode({
        kind: "test",
        qualifiedName,
        displayName: titleArg.text,
        file: p,
        exported: false,
        spanStart: start,
        spanEnd: end,
        ...lineRangeOf(sf, start, end),
        evidence: [{ file: p, kind: "source", ...linesAsEvidence(sf, start, end) }]
      });
      testNodes.push(testNode);
      edges.add(fileNode, "contains", testNode, [
        { file: p, kind: "source", ...linesAsEvidence(sf, start, end) }
      ]);
      const intervals = testIntervalsByFile.get(p) ?? [];
      intervals.push({ start: callbackArg.getStart(sf), end: callbackArg.getEnd() });
      testIntervalsByFile.set(p, intervals);

      // Static linkage only, never runtime coverage: calls inside the test body
      // are compiler-certain links; bare accesses are compiler-likely links.
      const consumedCallees = new Set<ts.Node>();
      const linkTarget = (nameNode: ts.Node, meta: EdgeMetadata, at: ts.Node): void => {
        const target = graphNodeForSymbol(checker.getSymbolAtLocation(nameNode));
        if (target && (target.kind === "function" || target.kind === "method")) {
          edges.add(testNode, "tests", target, [lineEvidence(sf, at, p)], meta);
        }
      };
      const visitTestBody = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const callee = n.expression;
          const nameNode = ts.isPropertyAccessExpression(callee)
            ? callee.name
            : ts.isIdentifier(callee)
              ? callee
              : null;
          if (nameNode) {
            consumedCallees.add(callee);
            linkTarget(nameNode, COMPILER_CERTAIN, n);
          }
        } else if (ts.isPropertyAccessExpression(n)) {
          // Bare property accesses on exercised instances are compiler-likely
          // links (fixture 02's `void controller.getUser`). Bare identifier
          // mentions are deliberately NOT linked: no fixture requires them and
          // they would over-link every imported-but-unexercised name.
          if (!consumedCallees.has(n)) {
            linkTarget(n.name, { origin: "compiler", confidence: "likely", resolution: "resolved" }, n);
          }
        }
        n.forEachChild(visitTestBody);
      };
      visitTestBody(callbackArg.body);
    }
  }

  // ---- pass 6: calls, references, dynamic dispatch, and Express routes ----------
  const routeNodes: GraphNode[] = [];
  const unresolvedNodes = new Map<string, GraphNode>();
  let resolvedCallCount = 0;
  let heuristicCallCount = 0;
  let dynamicUnresolvedCount = 0;
  let nonGraphCalleeCount = 0;

  const registrationByEntityKey = new Map<string, SymbolRegistration>();
  for (const registration of registry.values()) {
    registrationByEntityKey.set(registration.node.entityKey, registration);
  }

  /** Call-site arity must fit some declaration of the candidate. */
  const arityAccepts = (candidate: GraphNode, argCount: number): boolean => {
    const registration = registrationByEntityKey.get(candidate.entityKey);
    if (!registration) {
      return true; // No signature information: do not over-filter.
    }
    return registration.declarations.some((decl) => {
      let params: ts.NodeArray<ts.ParameterDeclaration> | undefined;
      if (
        ts.isFunctionDeclaration(decl) ||
        ts.isMethodDeclaration(decl) ||
        ts.isMethodSignature(decl)
      ) {
        params = decl.parameters;
      } else if (
        ts.isPropertyDeclaration(decl) &&
        decl.initializer !== undefined &&
        (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
      ) {
        params = decl.initializer.parameters;
      }
      if (!params) {
        return false;
      }
      let required = 0;
      let max = 0;
      let rest = false;
      for (const param of params) {
        if (param.dotDotDotToken) {
          rest = true;
          continue;
        }
        max += 1;
        if (param.questionToken === undefined && param.initializer === undefined) {
          required += 1;
        }
      }
      return argCount >= required && (rest || argCount <= max);
    });
  };

  const addRoute = (
    label: string,
    p: string,
    fileNode: GraphNode,
    spanNode: { start: number; end: number; lineStart: number; lineEnd: number },
    bodyHash: string | null,
    handler: GraphNode | null,
    routesToMeta: EdgeMetadata,
    evidence: Evidence[]
  ): GraphNode => {
    const routeNode = buildNode({
      kind: "route",
      qualifiedName: `route:${label}@${p}`,
      displayName: label,
      file: p,
      exported: false,
      spanStart: spanNode.start,
      spanEnd: spanNode.end,
      lineStart: spanNode.lineStart,
      lineEnd: spanNode.lineEnd,
      bodyHash,
      evidence
    });
    routeNodes.push(routeNode);
    edges.add(fileNode, "contains", routeNode, evidence);
    if (handler) {
      edges.add(routeNode, "routes_to", handler, evidence, routesToMeta);
    }
    return routeNode;
  };

  for (const scanned of scan.indexedFiles) {
    if (scanned.language === "markdown") {
      continue;
    }
    const sf = sourceFileFor(scanned);
    const p = scanned.normalizedPath;
    const fileNode = fileNodes.get(p);
    if (!sf || !fileNode) {
      continue;
    }
    const testIntervals = testIntervalsByFile.get(p) ?? [];

    const visit = (n: ts.Node): void => {
      // Decorator applications are not calls made by the decorated member;
      // emitting them as compiler-certain calls would fabricate edges on
      // NestJS/TypeORM-style repositories. Skip the whole decorator subtree.
      if (ts.isDecorator(n)) {
        return;
      }
      // Test callbacks are owned by the tests pass (pass 5).
      const pos = n.getStart(sf);
      if (testIntervals.some((t) => pos >= t.start && n.getEnd() <= t.end)) {
        return;
      }

      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        if (
          ts.isPropertyAccessExpression(callee) &&
          EXPRESS_ROUTE_METHODS.has(callee.name.text) &&
          n.arguments.length >= 2 &&
          isExpressReceiver(callee.expression, checker)
        ) {
          const pathArg = n.arguments[0];
          const handlerArg = n.arguments[n.arguments.length - 1];
          const verb = callee.name.text.toUpperCase();
          const literal = pathArg !== undefined && ts.isStringLiteralLike(pathArg);
          const label = literal
            ? `${verb} ${pathArg.text}`
            : `${verb} <computed:${pathArg?.getText(sf) ?? "?"}>`;
          let handler: GraphNode | null = null;
          if (handlerArg !== undefined) {
            const handlerName = ts.isPropertyAccessExpression(handlerArg)
              ? handlerArg.name
              : ts.isIdentifier(handlerArg)
                ? handlerArg
                : null;
            handler = handlerName
              ? graphNodeForSymbol(checker.getSymbolAtLocation(handlerName))
              : null;
            if (handler && handler.kind !== "function" && handler.kind !== "method") {
              handler = null;
            }
          }
          if (!handler) {
            diagnostics.push({
              file: p,
              message: `Express route ${label} has a dynamic or unresolved handler; route node emitted without a routes_to edge.`
            });
          }
          const evidence = [lineEvidence(sf, n, p)];
          const range = lineRangeOf(sf, n.getStart(sf), n.getEnd());
          addRoute(
            label,
            p,
            fileNode,
            { start: n.getStart(sf), end: n.getEnd(), ...range },
            bodyHashOfText(n.getText(sf)),
            handler,
            literal
              ? COMPILER_CERTAIN
              : { origin: "heuristic", confidence: "likely", resolution: "partial" },
            evidence
          );
          n.forEachChild(visit);
          return;
        }

        if (ts.isElementAccessExpression(callee)) {
          const enclosing = enclosingNode(p, pos, ["function", "method"]);
          if (enclosing) {
            const label = dynamicCallLabel(callee, sf);
            const key = `${p}|${label}`;
            let unresolvedNode = unresolvedNodes.get(key);
            if (!unresolvedNode) {
              unresolvedNode = buildNode({
                kind: "unresolved",
                qualifiedName: `${p}::<unresolved ${label}>`,
                displayName: label,
                file: p,
                exported: false,
                spanStart: n.getStart(sf),
                spanEnd: n.getEnd(),
                ...lineRangeOf(sf, n.getStart(sf), n.getEnd()),
                evidence: [lineEvidence(sf, n, p)]
              });
              unresolvedNodes.set(key, unresolvedNode);
              edges.add(fileNode, "contains", unresolvedNode, [lineEvidence(sf, n, p)]);
            }
            // Honest dynamic dispatch: no invented concrete destination.
            edges.add(enclosing, "calls", unresolvedNode, [lineEvidence(sf, n, p)], {
              origin: "heuristic",
              confidence: "inferred",
              resolution: "unresolved"
            });
            dynamicUnresolvedCount += 1;
          } else {
            diagnostics.push({
              file: p,
              message: `Dynamic ${callee.getText(sf)}() call outside any symbol span; no unresolved call emitted.`
            });
          }
        } else {
          const nameNode = ts.isPropertyAccessExpression(callee)
            ? callee.name
            : ts.isIdentifier(callee)
              ? callee
              : null;
          const enclosing = nameNode ? enclosingNode(p, pos, ["function", "method"]) : null;
          if (nameNode && enclosing) {
            const symbol = checker.getSymbolAtLocation(nameNode);
            const target = graphNodeForSymbol(symbol);
            if (target && (target.kind === "function" || target.kind === "method")) {
              edges.add(enclosing, "calls", target, [lineEvidence(sf, n, p)]);
              resolvedCallCount += 1;
            } else if (!symbol && ts.isPropertyAccessExpression(callee)) {
              // The checker could not resolve the property (e.g. an `any`
              // receiver). A unique repo-wide name match is an honest
              // heuristic claim, never a compiler fact.
              const candidates = (symbolsByDisplayName.get(nameNode.text) ?? []).filter(
                (c) =>
                  (c.kind === "function" || c.kind === "method") &&
                  arityAccepts(c, n.arguments.length)
              );
              const candidate = candidates[0];
              if (candidates.length === 1 && candidate !== undefined) {
                edges.add(enclosing, "calls", candidate, [lineEvidence(sf, n, p)], {
                  origin: "heuristic",
                  confidence: "likely",
                  resolution: "partial"
                });
                heuristicCallCount += 1;
              } else {
                diagnostics.push({
                  file: p,
                  message: `Unresolved property call .${nameNode.text}() with ${candidates.length} name candidates; no calls edge emitted.`
                });
              }
            } else if (!target) {
              nonGraphCalleeCount += 1;
            }
          }
        }
      } else if (ts.isNewExpression(n)) {
        // Constructor calls are excluded from `calls`; the class use is a
        // compiler-certain type reference instead (fixture contract).
        const enclosing = enclosingNode(p, pos, ["function", "method", "class"]);
        const expr = unwrapExpression(n.expression);
        const nameNode = ts.isPropertyAccessExpression(expr) ? expr.name : expr;
        const target = ts.isIdentifier(nameNode) || ts.isPropertyAccessExpression(expr)
          ? graphNodeForSymbol(checker.getSymbolAtLocation(nameNode))
          : null;
        if (enclosing && target && target.kind === "class") {
          edges.add(enclosing, "references", target, [lineEvidence(sf, nameNode, p)]);
        }
      } else if (ts.isTypeReferenceNode(n)) {
        const enclosing = enclosingNode(p, pos, ["function", "method", "class", "interface", "type"]);
        const typeName = n.typeName;
        const nameNode = ts.isQualifiedName(typeName) ? typeName.right : typeName;
        const target = graphNodeForSymbol(checker.getSymbolAtLocation(nameNode));
        if (
          enclosing &&
          target &&
          (target.kind === "class" || target.kind === "interface" || target.kind === "type")
        ) {
          edges.add(enclosing, "references", target, [lineEvidence(sf, n, p)]);
        }
      }
      n.forEachChild(visit);
    };
    visit(sf);
  }

  // ---- pass 7: Next.js file-convention routes ------------------------------------
  for (const scanned of scan.indexedFiles) {
    if (scanned.language === "markdown") {
      continue;
    }
    const p = scanned.normalizedPath;
    const role = nextRouteRole(p);
    const fileNode = fileNodes.get(p);
    if (!role || !fileNode) {
      continue;
    }
    const fileRegistrations = [...registry.values()].filter(
      (r) => r.node.file === p && r.node.kind === "function"
    );
    const routeFor = (label: string, registration: SymbolRegistration): void => {
      const { node } = registration;
      const evidence: Evidence[] = [
        {
          file: p,
          kind: "source",
          lineStart: node.lineStart ?? 1,
          lineEnd: node.lineEnd ?? node.lineStart ?? 1
        }
      ];
      addRoute(
        label,
        p,
        fileNode,
        {
          start: node.spanStart ?? 0,
          end: node.spanEnd ?? 0,
          lineStart: node.lineStart ?? 1,
          lineEnd: node.lineEnd ?? 1
        },
        node.bodyHash,
        node,
        COMPILER_CERTAIN,
        evidence
      );
    };
    if (role.kind === "app-handler") {
      for (const verb of [...HTTP_VERB_NAMES].sort()) {
        const registration = registry.get(`${p}|${verb}`);
        if (registration && registration.node.exported) {
          routeFor(`${verb} ${role.urlPath}`, registration);
        }
      }
      continue;
    }
    const defaultExported = fileRegistrations.find((r) =>
      r.declarations.some(
        (d) => (ts.getCombinedModifierFlags(d as ts.Declaration) & ts.ModifierFlags.Default) !== 0
      )
    );
    if (!defaultExported) {
      diagnostics.push({
        file: p,
        message: `Next.js ${role.kind} file has no default-exported function; no route node emitted.`
      });
      continue;
    }
    const label = role.kind === "pages-api" ? `ANY ${role.urlPath}` : `PAGE ${role.urlPath}`;
    routeFor(label, defaultExported);
  }

  diagnostics.push({
    file: null,
    message:
      `Call resolution: ${resolvedCallCount} compiler-resolved, ` +
      `${heuristicCallCount} heuristic name-matched, ` +
      `${dynamicUnresolvedCount} dynamic unresolved, ` +
      `${nonGraphCalleeCount} callees outside the graph (built-ins, externals, variables).`
  });

  const nodes = [
    packageNode,
    ...fileNodes.values(),
    ...symbolNodes,
    ...externalNodes.values(),
    ...adrNodes,
    ...testNodes,
    ...routeNodes,
    ...unresolvedNodes.values()
  ].sort(
    (a, b) => a.canonicalIdentity.localeCompare(b.canonicalIdentity)
  );

  return {
    packageName,
    files: files.sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath)),
    nodes,
    edges: edges.all(),
    diagnostics
  };
}
