import { readFileSync, readdirSync, statSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  detectLanguage,
  isGeneratedPath,
  UNKNOWN_TEXT_LANGUAGE,
  type LanguageId,
  type LanguageRegistration
} from "./languageRegistry.js";

export interface ScannedFile {
  /** Absolute path on disk. */
  absolutePath: string;
  /** Repository-relative path with forward slashes. */
  normalizedPath: string;
  /** true = becomes a graph file node; false = compiler/support only. */
  indexed: boolean;
  language: LanguageId;
  isGenerated: boolean;
  registration: LanguageRegistration;
}

export interface ScanResult {
  indexedFiles: ScannedFile[];
  supportFiles: ScannedFile[];
  diagnostics: Array<{ code: string; message: string }>;
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

const CAPTURED_CONFIGURATION_NAMES = new Set([
  "pnpm-lock.yaml",
  "yarn.lock",
  "tadori.rules.json",
  ".gitignore",
  ".tadoriignore"
]);
const PROJECT_CONFIGURATION_NAMES = new Set([
  "package.json", "tsconfig.json", "jsconfig.json", "pyproject.toml", "requirements.txt",
  "compile_commands.json", "go.mod", "go.work", "Cargo.toml", "pom.xml", "build.gradle",
  "build.gradle.kts", "settings.gradle", "buf.yaml", "buf.work.yaml", ".terraform.lock.hcl"
]);
const MAX_INDEXABLE_FILE_BYTES = 5 * 1024 * 1024;

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

function classify(
  normalizedPath: string,
  registration: LanguageRegistration
): Pick<ScannedFile, "indexed" | "language" | "isGenerated" | "registration"> {
  if (normalizedPath.endsWith(".d.ts") || normalizedPath.endsWith(".d.mts") || normalizedPath.endsWith(".d.cts")) {
    // Declaration shims participate in compiler resolution without becoming
    // graph file nodes (golden fixture contract §2).
    return { indexed: false, language: registration.id, isGenerated: true, registration };
  }
  const basename = path.posix.basename(normalizedPath);
  const configurationOnly =
    CAPTURED_CONFIGURATION_NAMES.has(basename) || PROJECT_CONFIGURATION_NAMES.has(basename);
  // JavaScript remains visible even when an explicit tsconfig excludes it;
  // the TS adapter then reports repository-only extraction for that file.
  const indexed = registration.id === "javascript" ? true : !configurationOnly;
  return {
    indexed,
    language: registration.id,
    isGenerated: isGeneratedPath(normalizedPath, registration),
    registration
  };
}

/** Walks the repository and splits files into indexed and support sets. */
export function scanRepository(root: string): ScanResult {
  const rules = readIgnoreRules(root);
  const diagnostics: Array<{ code: string; message: string }> = [];
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
      if (stats.size > MAX_INDEXABLE_FILE_BYTES) {
        continue;
      }
      const bytes = readFileSync(absolute);
      if (bytes.includes(0)) continue;
      const firstLine = bytes.toString("utf8").split(/\r?\n/, 1)[0] ?? "";
      const registration = detectLanguage(rel, firstLine) ?? UNKNOWN_TEXT_LANGUAGE;
      const { indexed, language, isGenerated } = classify(rel, registration);
      const file: ScannedFile = {
        absolutePath: absolute,
        normalizedPath: rel,
        indexed,
        language,
        isGenerated,
        registration
      };
      (indexed ? indexedFiles : supportFiles).push(file);
    }
  };

  walk(root);
  indexedFiles.sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath));
  supportFiles.sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath));
  return { indexedFiles, supportFiles, diagnostics };
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
