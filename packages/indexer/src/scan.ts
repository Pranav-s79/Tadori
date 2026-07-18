import { readFileSync, readdirSync, statSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

export interface ScannedFile {
  /** Absolute path on disk. */
  absolutePath: string;
  /** Repository-relative path with forward slashes. */
  normalizedPath: string;
  /** true = becomes a graph file node; false = compiler/support only. */
  indexed: boolean;
  language: "typescript" | "javascript" | "markdown" | "json" | "other";
}

export interface ScanResult {
  indexedFiles: ScannedFile[];
  supportFiles: ScannedFile[];
}

/** Built-in exclusions per frozen corrections §8. */
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".tadori",
  ".next",
  ".turbo",
  ".cache"
]);

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const JS_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const CAPTURED_CONFIGURATION_NAMES = new Set([
  "pnpm-lock.yaml",
  "yarn.lock",
  ".gitignore",
  ".tadoriignore"
]);

export function normalizePath(root: string, absolute: string): string {
  const rel = path.relative(root, absolute).split(path.sep).join("/");
  if (rel.startsWith("..")) {
    throw new Error(`Path ${absolute} escapes repository root ${root}`);
  }
  return rel;
}

interface IgnoreRule {
  kind: "dir" | "suffix" | "exact";
  value: string;
}

/**
 * Minimal .tadoriignore / .gitignore support for Weeks 1-2: bare directory
 * names (`name/`), `*.ext` suffix patterns, and exact relative paths. The full
 * gitignore grammar is a later-milestone concern.
 */
function readIgnoreRules(root: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const name of [".gitignore", ".tadoriignore"]) {
    const filePath = path.join(root, name);
    if (!existsSync(filePath)) {
      continue;
    }
    for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("#")) {
        continue;
      }
      if (line.endsWith("/")) {
        rules.push({ kind: "dir", value: line.slice(0, -1) });
      } else if (line.startsWith("*.")) {
        rules.push({ kind: "suffix", value: line.slice(1) });
      } else {
        rules.push({ kind: "exact", value: line });
      }
    }
  }
  return rules;
}

function isIgnored(relPath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
  const base = path.posix.basename(relPath);
  if (isDirectory && EXCLUDED_DIRECTORIES.has(base)) {
    return true;
  }
  for (const rule of rules) {
    if (rule.kind === "dir" && isDirectory && (base === rule.value || relPath === rule.value)) {
      return true;
    }
    if (rule.kind === "suffix" && !isDirectory && relPath.endsWith(rule.value)) {
      return true;
    }
    if (rule.kind === "exact" && relPath === rule.value) {
      return true;
    }
  }
  return false;
}

function classify(normalizedPath: string): Pick<ScannedFile, "indexed" | "language"> {
  const ext = path.posix.extname(normalizedPath).toLowerCase();
  if (normalizedPath.endsWith(".d.ts") || normalizedPath.endsWith(".d.mts") || normalizedPath.endsWith(".d.cts")) {
    // Declaration shims participate in compiler resolution without becoming
    // graph file nodes (golden fixture contract §2).
    return { indexed: false, language: "typescript" };
  }
  if (TS_EXTENSIONS.has(ext)) {
    return { indexed: true, language: "typescript" };
  }
  if (JS_EXTENSIONS.has(ext)) {
    return { indexed: true, language: "javascript" };
  }
  if (ext === ".md") {
    return { indexed: true, language: "markdown" };
  }
  if (ext === ".json") {
    return { indexed: false, language: "json" };
  }
  return { indexed: false, language: "other" };
}

/** Walks the repository and splits files into indexed and support sets. */
export function scanRepository(root: string): ScanResult {
  const rules = readIgnoreRules(root);
  const indexedFiles: ScannedFile[] = [];
  const supportFiles: ScannedFile[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const absolute = path.join(dir, entry);
      const rel = normalizePath(root, absolute);
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        if (!isIgnored(rel, true, rules)) {
          walk(absolute);
        }
        continue;
      }
      if (isIgnored(rel, false, rules)) {
        continue;
      }
      const { indexed, language } = classify(rel);
      const file: ScannedFile = { absolutePath: absolute, normalizedPath: rel, indexed, language };
      if (language === "other" && !CAPTURED_CONFIGURATION_NAMES.has(path.posix.basename(rel))) {
        continue;
      }
      (indexed ? indexedFiles : supportFiles).push(file);
    }
  };

  walk(root);
  indexedFiles.sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath));
  supportFiles.sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath));
  return { indexedFiles, supportFiles };
}

/** Nearest package.json `name` walking up from the file toward the root. */
export function detectPackageName(root: string, fileAbsolutePath: string): string | null {
  let dir = path.dirname(fileAbsolutePath);
  const rootResolved = path.resolve(root);
  for (;;) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown };
        if (typeof parsed.name === "string" && parsed.name.length > 0) {
          return parsed.name;
        }
      } catch {
        // Malformed manifest: fall through to the parent directory.
      }
    }
    if (path.resolve(dir) === rootResolved) {
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
