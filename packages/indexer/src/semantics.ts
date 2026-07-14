import path from "node:path";
import ts from "typescript";
import type { Confidence, Origin, Resolution } from "@tadori/core";

/** Express router/app methods that declare HTTP routes (`use` mounts are not routes). */
export const EXPRESS_ROUTE_METHODS = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
  "all"
]);

/** Next.js App Router handler exports and the doc-link generic-name stoplist. */
export const HTTP_VERB_NAMES = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS"
]);

export interface EdgeMetadata {
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
}

export const COMPILER_CERTAIN: EdgeMetadata = {
  origin: "compiler",
  confidence: "certain",
  resolution: "resolved"
};

const ORIGIN_RANK: Record<Origin, number> = {
  compiler: 5,
  doc: 4,
  git: 3,
  human: 2,
  heuristic: 1,
  llm: 0
};
const CONFIDENCE_RANK: Record<Confidence, number> = { certain: 2, likely: 1, inferred: 0 };
const RESOLUTION_RANK: Record<Resolution, number> = { resolved: 2, partial: 1, unresolved: 0 };

/**
 * Deterministic strength ordering used when two extraction passes produce the
 * same stable edge (e.g. a test both accesses and calls the same method): the
 * stronger claim wins, never the weaker one.
 */
export function metadataScore(meta: EdgeMetadata): number {
  return (
    CONFIDENCE_RANK[meta.confidence] * 100 +
    RESOLUTION_RANK[meta.resolution] * 10 +
    ORIGIN_RANK[meta.origin]
  );
}

/** Strip parentheses and type-assertion wrappers without changing the value. */
export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
    } else if (ts.isNonNullExpression(current)) {
      current = current.expression;
    } else if (ts.isSatisfiesExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/**
 * Frozen label for a dynamic `obj[key]()` dispatch: the unwrapped object and
 * index expressions, e.g. `handlers[key as keyof typeof handlers]()` ->
 * `handlers[key]` and `(c as unknown as R)[action]()` -> `controller[action]`.
 */
export function dynamicCallLabel(callee: ts.ElementAccessExpression, sf: ts.SourceFile): string {
  const objectText = unwrapExpression(callee.expression).getText(sf);
  const indexText = unwrapExpression(callee.argumentExpression).getText(sf);
  return `${objectText}[${indexText}]`;
}

/** True when the callee's receiver type is declared by the `express` module. */
export function isExpressReceiver(
  receiver: ts.Expression,
  checker: ts.TypeChecker
): boolean {
  const type = checker.getTypeAtLocation(receiver);
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  for (const decl of symbol?.declarations ?? []) {
    const fileName = decl.getSourceFile().fileName;
    if (/node_modules[\\/]express[\\/]/.test(fileName)) {
      return true;
    }
    let ancestor: ts.Node | undefined = decl.parent;
    while (ancestor !== undefined) {
      if (
        ts.isModuleDeclaration(ancestor) &&
        ts.isStringLiteral(ancestor.name) &&
        ancestor.name.text === "express"
      ) {
        return true;
      }
      ancestor = ancestor.parent;
    }
  }
  return false;
}

export type NextRouteRole =
  | { kind: "app-handler"; urlPath: string }
  | { kind: "app-page"; urlPath: string }
  | { kind: "pages-api"; urlPath: string }
  | { kind: "pages-page"; urlPath: string };

/**
 * File-convention route roles for Next.js. Dynamic `[param]` segments are kept
 * verbatim in the URL path (no fixture fixes a translation; documented in
 * IMPLEMENTATION_STATUS.md).
 */
export function nextRouteRole(normalizedPath: string): NextRouteRole | null {
  const appHandler = /^app\/(?:(.*)\/)?route\.(?:ts|tsx|js|jsx)$/.exec(normalizedPath);
  if (appHandler) {
    return { kind: "app-handler", urlPath: `/${appHandler[1] ?? ""}`.replace(/\/$/, "") || "/" };
  }
  const appPage = /^app\/(?:(.*)\/)?page\.(?:ts|tsx|js|jsx)$/.exec(normalizedPath);
  if (appPage) {
    return { kind: "app-page", urlPath: `/${appPage[1] ?? ""}`.replace(/\/$/, "") || "/" };
  }
  const pagesApi = /^pages\/api\/(.+)\.(?:ts|tsx|js|jsx)$/.exec(normalizedPath);
  if (pagesApi) {
    const trimmed = pagesApi[1] === "index" ? "" : `/${pagesApi[1]}`.replace(/\/index$/, "");
    return { kind: "pages-api", urlPath: `/api${trimmed}` };
  }
  const pagesPage = /^pages\/(.+)\.(?:tsx|jsx)$/.exec(normalizedPath);
  if (pagesPage && pagesPage[1] !== undefined && !path.posix.basename(pagesPage[1]).startsWith("_")) {
    const trimmed = pagesPage[1] === "index" ? "" : `/${pagesPage[1]}`.replace(/\/index$/, "");
    return { kind: "pages-page", urlPath: trimmed === "" ? "/" : trimmed };
  }
  return null;
}

export interface AdrHeading {
  /** One-based line of the heading. */
  line: number;
  /** Full heading text after `# `. */
  title: string;
  /** The `ADR-<n>` identifier extracted from the heading. */
  adrId: string;
}

/** First markdown H1 whose text carries an `ADR-<n>` identifier. */
export function findAdrHeading(lines: readonly string[]): AdrHeading | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    const heading = /^#\s+(.+)$/.exec(line);
    if (!heading || heading[1] === undefined) {
      continue;
    }
    const adrId = /(ADR-\d+)/.exec(heading[1]);
    if (!adrId || adrId[1] === undefined) {
      return null; // First H1 is not an ADR heading: not an ADR document.
    }
    return { line: i + 1, title: heading[1].trim(), adrId: adrId[1] };
  }
  return null;
}

/** All `backtick` terms on one markdown line, left to right. */
export function backtickTerms(line: string): string[] {
  const terms: string[] = [];
  const pattern = /`([^`]+)`/g;
  for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
    if (match[1] !== undefined) {
      terms.push(match[1]);
    }
  }
  return terms;
}

/** Path-shaped doc-link terms (`src/math.ts`) versus symbol terms (`factorial`). */
export function isPathTerm(term: string): boolean {
  return term.includes("/") || /\.(?:m?[jt]sx?|md|json)$/.test(term);
}
