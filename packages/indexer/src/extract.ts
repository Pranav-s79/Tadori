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
    evidence: Evidence[]
  ): void {
    const canonical = edgeCanonicalIdentity(src.entityKey, relation, dst.entityKey);
    const existing = this.edges.get(canonical);
    if (existing) {
      existing.evidence.push(...evidence);
      return;
    }
    this.edges.set(canonical, {
      srcEntityKey: src.entityKey,
      relation,
      dstEntityKey: dst.entityKey,
      canonicalIdentity: canonical,
      entityKey: entityKey(canonical),
      origin: "compiler",
      confidence: "certain",
      resolution: "resolved",
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

  const nodes = [packageNode, ...fileNodes.values(), ...symbolNodes, ...externalNodes.values()].sort(
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
