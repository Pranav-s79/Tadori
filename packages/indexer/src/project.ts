import { existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface ProjectServices {
  languageService: ts.LanguageService;
  program: ts.Program;
  checker: ts.TypeChecker;
  compilerOptions: ts.CompilerOptions;
  /** Absolute, platform-native paths of every program root file. */
  rootFileNames: string[];
  tsconfigPath: string | null;
}

/** Discovers the repository tsconfig (root-level for Weeks 1-2). */
export function findTsconfig(root: string): string | null {
  const candidate = path.join(root, "tsconfig.json");
  return existsSync(candidate) ? candidate : null;
}

function parseTsconfig(root: string, tsconfigPath: string): ts.ParsedCommandLine {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Failed to read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`
    );
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root, undefined, tsconfigPath);
  const fatal = parsed.errors.filter((e) => e.category === ts.DiagnosticCategory.Error);
  if (fatal.length > 0) {
    throw new Error(
      `Failed to parse ${tsconfigPath}: ${fatal
        .map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n"))
        .join("; ")}`
    );
  }
  return parsed;
}

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true
};

/**
 * Builds the TypeScript LanguageService for one repository. Program roots are
 * the union of the tsconfig file list and the scanned source files, so files
 * outside the tsconfig `include` globs still resolve and extract.
 */
export function createProjectServices(
  root: string,
  scannedSourceAbsolutePaths: string[]
): ProjectServices {
  const tsconfigPath = findTsconfig(root);
  const parsed = tsconfigPath ? parseTsconfig(root, tsconfigPath) : null;
  const compilerOptions: ts.CompilerOptions = parsed ? parsed.options : { ...DEFAULT_OPTIONS };
  const allowJs = compilerOptions.allowJs === true || compilerOptions.checkJs === true;

  const jsExtensions = new Set([".js", ".jsx", ".mjs", ".cjs"]);
  const programCompatible = (file: string): boolean => {
    const ext = path.extname(file).toLowerCase();
    if (jsExtensions.has(ext)) {
      return allowJs;
    }
    return ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts";
  };

  const rootFileNames = Array.from(
    new Set([
      ...(parsed?.fileNames ?? []),
      ...scannedSourceAbsolutePaths.filter(programCompatible)
    ])
  )
    .map((f) => path.resolve(f))
    .sort();

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => rootFileNames,
    getScriptVersion: () => "0",
    getScriptSnapshot: (fileName) => {
      const text = ts.sys.readFile(fileName);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories
  };

  const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
  const program = languageService.getProgram();
  if (!program) {
    throw new Error(`LanguageService produced no program for ${root}`);
  }
  return {
    languageService,
    program,
    checker: program.getTypeChecker(),
    compilerOptions,
    rootFileNames,
    tsconfigPath
  };
}
