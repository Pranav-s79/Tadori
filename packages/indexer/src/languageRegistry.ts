import path from "node:path";
import type { ExtractionCapability } from "@tadori/core";

export type LanguageId = string;

export interface LanguageRegistration {
  id: LanguageId;
  extensions: readonly string[];
  filenames: readonly string[];
  shebangs: readonly RegExp[];
  precedence: number;
  parserId: string | null;
  parserVersion: string | null;
  extractorId: string;
  extractorVersion: string;
  capability: ExtractionCapability;
  projectManifests: readonly string[];
  generatedPathPatterns: readonly RegExp[];
  queryBundle: string | null;
}

const registrations: readonly LanguageRegistration[] = [
  {
    id: "typescript", extensions: [".ts", ".tsx", ".mts", ".cts"], filenames: [], shebangs: [], precedence: 200,
    parserId: "typescript-language-service", parserVersion: "typescript-package", extractorId: "tadori-typescript", extractorVersion: "1", capability: "semantic",
    projectManifests: ["tsconfig.json", "package.json"], generatedPathPatterns: [/\.d\.(?:ts|mts|cts)$/i], queryBundle: null
  },
  {
    id: "javascript", extensions: [".js", ".jsx", ".mjs", ".cjs"], filenames: [], shebangs: [/^#!.*\bnode\b/], precedence: 190,
    parserId: "typescript-language-service", parserVersion: "typescript-package", extractorId: "tadori-typescript", extractorVersion: "1", capability: "semantic",
    projectManifests: ["package.json", "jsconfig.json", "tsconfig.json"], generatedPathPatterns: [/\.min\.js$/i], queryBundle: null
  },
  {
    id: "python", extensions: [".py", ".pyi"], filenames: [], shebangs: [/^#!.*\bpython(?:3(?:\.\d+)?)?\b/], precedence: 180,
    parserId: "tree-sitter-python", parserVersion: "tree-sitter-wasms/0.1.13", extractorId: "tadori-tree-sitter", extractorVersion: "1", capability: "structural",
    projectManifests: ["pyproject.toml", "setup.py", "requirements.txt"], generatedPathPatterns: [/\bsite-packages\b/i], queryBundle: "structural-v1"
  },
  {
    id: "cpp", extensions: [".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx"], filenames: [], shebangs: [], precedence: 170,
    parserId: "tree-sitter-cpp", parserVersion: "tree-sitter-wasms/0.1.13", extractorId: "tadori-tree-sitter", extractorVersion: "1", capability: "structural",
    projectManifests: ["compile_commands.json", "CMakeLists.txt"], generatedPathPatterns: [/\b(?:cmake-build|generated)\b/i], queryBundle: "structural-v1"
  },
  {
    id: "c", extensions: [".c", ".h"], filenames: [], shebangs: [], precedence: 160,
    parserId: "tree-sitter-c", parserVersion: "tree-sitter-wasms/0.1.13", extractorId: "tadori-tree-sitter", extractorVersion: "1", capability: "structural",
    projectManifests: ["compile_commands.json", "CMakeLists.txt", "Makefile"], generatedPathPatterns: [/\b(?:cmake-build|generated)\b/i], queryBundle: "structural-v1"
  },
  {
    id: "go", extensions: [".go"], filenames: [], shebangs: [], precedence: 150,
    parserId: "tree-sitter-go", parserVersion: "tree-sitter-wasms/0.1.13", extractorId: "tadori-tree-sitter", extractorVersion: "1", capability: "structural",
    projectManifests: ["go.mod", "go.work"], generatedPathPatterns: [/\.pb\.go$/i], queryBundle: "structural-v1"
  },
  {
    id: "rust", extensions: [".rs"], filenames: [], shebangs: [], precedence: 140,
    parserId: "tree-sitter-rust", parserVersion: "tree-sitter-wasms/0.1.13", extractorId: "tadori-tree-sitter", extractorVersion: "1", capability: "structural",
    projectManifests: ["Cargo.toml"], generatedPathPatterns: [/\btarget\b/i], queryBundle: "structural-v1"
  },
  {
    id: "java", extensions: [".java"], filenames: [], shebangs: [], precedence: 130,
    parserId: "tree-sitter-java", parserVersion: "tree-sitter-wasms/0.1.13", extractorId: "tadori-tree-sitter", extractorVersion: "1", capability: "structural",
    projectManifests: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle"], generatedPathPatterns: [/\b(?:build|generated)\b/i], queryBundle: "structural-v1"
  },
  {
    id: "protobuf", extensions: [".proto"], filenames: [], shebangs: [], precedence: 120,
    parserId: null, parserVersion: null, extractorId: "tadori-interface-files", extractorVersion: "1", capability: "repository",
    projectManifests: ["buf.yaml", "buf.work.yaml"], generatedPathPatterns: [], queryBundle: null
  },
  {
    id: "terraform", extensions: [".tf", ".tfvars"], filenames: [], shebangs: [], precedence: 110,
    parserId: null, parserVersion: null, extractorId: "tadori-interface-files", extractorVersion: "1", capability: "repository",
    projectManifests: [".terraform.lock.hcl"], generatedPathPatterns: [/\.terraform\//i], queryBundle: null
  },
  {
    id: "yaml", extensions: [".yaml", ".yml"], filenames: [], shebangs: [], precedence: 100,
    parserId: null, parserVersion: null, extractorId: "tadori-interface-files", extractorVersion: "1", capability: "repository",
    projectManifests: [], generatedPathPatterns: [], queryBundle: null
  },
  {
    id: "dockerfile", extensions: [], filenames: ["Dockerfile", "Containerfile"], shebangs: [], precedence: 210,
    parserId: null, parserVersion: null, extractorId: "tadori-interface-files", extractorVersion: "1", capability: "repository",
    projectManifests: [], generatedPathPatterns: [], queryBundle: null
  },
  {
    id: "markdown", extensions: [".md", ".markdown"], filenames: [], shebangs: [], precedence: 90,
    parserId: null, parserVersion: null, extractorId: "tadori-interface-files", extractorVersion: "1", capability: "repository",
    projectManifests: [], generatedPathPatterns: [], queryBundle: null
  },
  {
    id: "json", extensions: [".json", ".jsonc"], filenames: [], shebangs: [], precedence: 80,
    parserId: null, parserVersion: null, extractorId: "tadori-interface-files", extractorVersion: "1", capability: "repository",
    projectManifests: ["package.json", "tsconfig.json", "compile_commands.json"], generatedPathPatterns: [/package-lock\.json$/i], queryBundle: null
  },
  {
    id: "shell", extensions: [".sh", ".bash"], filenames: ["Makefile"], shebangs: [/^#!.*\b(?:ba|z|k)?sh\b/], precedence: 70,
    parserId: null, parserVersion: null, extractorId: "tadori-interface-files", extractorVersion: "1", capability: "repository",
    projectManifests: [], generatedPathPatterns: [], queryBundle: null
  },
  {
    id: "toml", extensions: [".toml"], filenames: ["go.mod", "go.work"], shebangs: [], precedence: 65,
    parserId: null, parserVersion: null, extractorId: "tadori-interface-files", extractorVersion: "1", capability: "repository",
    projectManifests: ["pyproject.toml", "Cargo.toml", "go.mod", "go.work"], generatedPathPatterns: [], queryBundle: null
  },
  {
    id: "cmake", extensions: [".cmake"], filenames: ["CMakeLists.txt"], shebangs: [], precedence: 60,
    parserId: null, parserVersion: null, extractorId: "tadori-interface-files", extractorVersion: "1", capability: "repository",
    projectManifests: ["CMakeLists.txt"], generatedPathPatterns: [], queryBundle: null
  },
  {
    id: "repository-config", extensions: [], filenames: [".gitignore", ".tadoriignore", "yarn.lock"], shebangs: [], precedence: 50,
    parserId: null, parserVersion: null, extractorId: "tadori-repository", extractorVersion: "1", capability: "repository",
    projectManifests: [], generatedPathPatterns: [], queryBundle: null
  }
] as const;

function validateRegistry(entries: readonly LanguageRegistration[]): void {
  const ids = new Set<string>();
  const filenames = new Map<string, string>();
  const extensions = new Map<string, string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate language id ${entry.id}`);
    ids.add(entry.id);
    for (const filename of entry.filenames) {
      const owner = filenames.get(filename.toLowerCase());
      if (owner) throw new Error(`Filename ${filename} is owned by both ${owner} and ${entry.id}`);
      filenames.set(filename.toLowerCase(), entry.id);
    }
    for (const extension of entry.extensions) {
      const normalized = extension.toLowerCase();
      const owner = extensions.get(normalized);
      if (owner) throw new Error(`Extension ${extension} is owned by both ${owner} and ${entry.id}`);
      extensions.set(normalized, entry.id);
    }
  }
}

validateRegistry(registrations);

export const LANGUAGE_REGISTRY: readonly LanguageRegistration[] = [...registrations].sort(
  (left, right) => right.precedence - left.precedence || left.id.localeCompare(right.id)
);

export const LANGUAGE_BY_ID: ReadonlyMap<LanguageId, LanguageRegistration> = new Map(
  LANGUAGE_REGISTRY.map((entry) => [entry.id, entry])
);

/** Safe text files without a bundled language receive repository-level support. */
export const UNKNOWN_TEXT_LANGUAGE: LanguageRegistration = {
  id: "unknown",
  extensions: [],
  filenames: [],
  shebangs: [],
  precedence: 0,
  parserId: null,
  parserVersion: null,
  extractorId: "tadori-repository",
  extractorVersion: "1",
  capability: "repository",
  projectManifests: [],
  generatedPathPatterns: [],
  queryBundle: null
};

export function detectLanguage(normalizedPath: string, firstLine = ""): LanguageRegistration | null {
  const filename = path.posix.basename(normalizedPath).toLowerCase();
  for (const entry of LANGUAGE_REGISTRY) {
    if (entry.filenames.some((candidate) => candidate.toLowerCase() === filename)) return entry;
  }
  const extension = path.posix.extname(normalizedPath).toLowerCase();
  for (const entry of LANGUAGE_REGISTRY) {
    if (entry.extensions.includes(extension)) return entry;
  }
  if (firstLine.startsWith("#!")) {
    for (const entry of LANGUAGE_REGISTRY) {
      if (entry.shebangs.some((pattern) => pattern.test(firstLine))) return entry;
    }
  }
  return null;
}

export function isGeneratedPath(normalizedPath: string, language: LanguageRegistration): boolean {
  return language.generatedPathPatterns.some((pattern) => pattern.test(normalizedPath));
}
