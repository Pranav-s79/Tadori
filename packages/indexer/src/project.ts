import { existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface ProjectServices {
  languageService: ts.LanguageService;
  program: ts.Program;
  checker: ts.TypeChecker;
  compilerOptions: ts.CompilerOptions;
  /** Resolution host frozen to the same captured repository generation. */
  moduleResolutionHost: ts.ModuleResolutionHost;
  /** Absolute, platform-native paths of every program root file. */
  rootFileNames: string[];
  tsconfigPath: string | null;
}

export interface ProjectRefreshResult {
  services: ProjectServices;
  changedFiles: string[];
  projectVersion: number;
}

/** Discovers the repository tsconfig (root-level for Weeks 1-2). */
export function findTsconfig(
  root: string,
  capturedTexts?: ReadonlyMap<string, string>
): string | null {
  const candidate = path.join(root, "tsconfig.json");
  return (capturedTexts?.has(canonicalAbsolute(candidate)) ?? existsSync(candidate))
    ? candidate
    : null;
}

function canonicalAbsolute(fileName: string): string {
  const resolved = path.resolve(fileName);
  return ts.sys.useCaseSensitiveFileNames ? resolved : resolved.toLowerCase();
}

const LIVE_REPOSITORY_DIRECTORIES = new Set([
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

interface CapturedFileSystem {
  useCaseSensitiveFileNames: boolean;
  fileExists(fileName: string): boolean;
  readFile(fileName: string): string | undefined;
  readDirectory(
    directoryName: string,
    extensions?: readonly string[],
    excludes?: readonly string[],
    includes?: readonly string[],
    depth?: number
  ): string[];
  directoryExists(directoryName: string): boolean;
  getDirectories(directoryName: string): string[];
  invalidate(): void;
}

/**
 * Repository paths are answered only from the immutable capture. Ignored
 * dependency/build directories and paths outside the repository remain live;
 * they are deliberately outside the workspace hash contract.
 */
function createCapturedFileSystem(
  root: string,
  capturedTexts?: ReadonlyMap<string, string>
): CapturedFileSystem {
  if (!capturedTexts) {
    return {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: (...arguments_) => [...ts.sys.readDirectory(...arguments_)],
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      invalidate: () => undefined
    };
  }
  const resolvedRoot = path.resolve(root);
  const insideCapturedRepository = (candidate: string): boolean => {
    const relative = path.relative(resolvedRoot, path.resolve(candidate));
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      return !relative.split(path.sep).some((segment) => LIVE_REPOSITORY_DIRECTORIES.has(segment));
    }
    return false;
  };
  let fileCache: string[] | null = null;
  let directoryCache: Set<string> | null = null;
  const capturedFiles = (): string[] => {
    fileCache ??= [...capturedTexts.keys()].map((file) => path.resolve(file));
    return fileCache;
  };
  const capturedDirectories = (): Set<string> => {
    if (directoryCache) {
      return directoryCache;
    }
    const directories = new Set<string>([canonicalAbsolute(resolvedRoot)]);
    for (const fileName of capturedFiles()) {
      let directory = path.dirname(fileName);
      while (insideCapturedRepository(directory)) {
        directories.add(canonicalAbsolute(directory));
        if (canonicalAbsolute(directory) === canonicalAbsolute(resolvedRoot)) {
          break;
        }
        directory = path.dirname(directory);
      }
    }
    directoryCache = directories;
    return directoryCache;
  };
  return {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    fileExists: (fileName) =>
      insideCapturedRepository(fileName)
        ? capturedTexts.has(canonicalAbsolute(fileName))
        : ts.sys.fileExists(fileName),
    readFile: (fileName) =>
      insideCapturedRepository(fileName)
        ? capturedTexts.get(canonicalAbsolute(fileName))
        : ts.sys.readFile(fileName),
    readDirectory: (directoryName, extensions, _excludes, _includes, depth) => {
      if (!insideCapturedRepository(directoryName)) {
        return [...ts.sys.readDirectory(directoryName, extensions, _excludes, _includes, depth)];
      }
      const resolvedDirectory = path.resolve(directoryName);
      return capturedFiles()
        .filter((fileName) => {
          const relative = path.relative(resolvedDirectory, fileName);
          if (relative.startsWith("..") || path.isAbsolute(relative)) {
            return false;
          }
          const fileDepth = relative.split(path.sep).length - 1;
          return (
            (depth === undefined || fileDepth <= depth) &&
            (extensions === undefined || extensions.some((extension) => fileName.endsWith(extension)))
          );
        })
        .sort();
    },
    directoryExists: (directoryName) =>
      insideCapturedRepository(directoryName)
        ? capturedDirectories().has(canonicalAbsolute(directoryName))
        : ts.sys.directoryExists(directoryName),
    getDirectories: (directoryName) => {
      if (!insideCapturedRepository(directoryName)) {
        return ts.sys.getDirectories(directoryName);
      }
      const resolvedDirectory = path.resolve(directoryName);
      const children = new Set<string>();
      for (const directory of capturedDirectories()) {
        const nativeDirectory = path.resolve(directory);
        if (path.dirname(nativeDirectory) === resolvedDirectory && nativeDirectory !== resolvedDirectory) {
          children.add(nativeDirectory);
        }
      }
      return [...children].sort();
    },
    invalidate: () => {
      fileCache = null;
      directoryCache = null;
    }
  };
}

function parseTsconfig(
  root: string,
  tsconfigPath: string,
  capturedTexts?: ReadonlyMap<string, string>
): ts.ParsedCommandLine {
  const capturedFileSystem = createCapturedFileSystem(root, capturedTexts);
  const configFile = ts.readConfigFile(
    tsconfigPath,
    capturedFileSystem.readFile
  );
  if (configFile.error) {
    throw new Error(
      `Failed to read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    capturedFileSystem,
    root,
    undefined,
    tsconfigPath
  );
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
 * Resolves the repository's effective compiler options from live disk (no
 * captured-generation texts), for callers that need the same
 * `extends`-resolved semantics as `createProjectServices` without building a
 * full LanguageService (e.g. the scanner's allowJs gate).
 */
export function resolveRootCompilerOptions(root: string): ts.CompilerOptions {
  const tsconfigPath = findTsconfig(root);
  if (!tsconfigPath) {
    return { ...DEFAULT_OPTIONS };
  }
  return parseTsconfig(root, tsconfigPath).options;
}

/**
 * Builds the TypeScript LanguageService for one repository. Program roots are
 * the union of the tsconfig file list and the scanned source files, so files
 * outside the tsconfig `include` globs still resolve and extract.
 */
export function createProjectServices(
  root: string,
  scannedSourceAbsolutePaths: string[],
  capturedTexts?: ReadonlyMap<string, string>
): ProjectServices {
  const immutableTexts = capturedTexts
    ? new Map([...capturedTexts].map(([fileName, text]) => [canonicalAbsolute(fileName), text]))
    : undefined;
  const capturedFileSystem = createCapturedFileSystem(root, immutableTexts);
  const tsconfigPath = findTsconfig(root, immutableTexts);
  const parsed = tsconfigPath ? parseTsconfig(root, tsconfigPath, immutableTexts) : null;
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
      ...(parsed?.fileNames.filter(
        (file) => immutableTexts === undefined || immutableTexts.has(canonicalAbsolute(file))
      ) ?? []),
      ...scannedSourceAbsolutePaths.filter(programCompatible)
    ])
  )
    .map((f) => path.resolve(f))
    .sort();

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => rootFileNames,
    getScriptVersion: () => "0",
    getScriptSnapshot: (fileName) => {
      const text = immutableTexts?.get(canonicalAbsolute(fileName)) ?? ts.sys.readFile(fileName);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: capturedFileSystem.fileExists,
    readFile: capturedFileSystem.readFile,
    readDirectory: capturedFileSystem.readDirectory,
    directoryExists: capturedFileSystem.directoryExists,
    getDirectories: capturedFileSystem.getDirectories
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
    moduleResolutionHost: capturedFileSystem,
    rootFileNames,
    tsconfigPath
  };
}

/**
 * Persistent TypeScript LanguageService host for Week 6 refreshes. Script
 * versions and snapshots change only for paths reported by the watcher, so
 * TypeScript can reuse the prior program rather than rebuilding from scratch.
 * Configuration changes deliberately require a new instance (the refresh
 * coordinator treats them as a full-index fallback).
 */
export class IncrementalProjectServices {
  private readonly root: string;
  private readonly languageService: ts.LanguageService;
  private readonly compilerOptions: ts.CompilerOptions;
  private readonly tsconfigPath: string | null;
  private readonly configuredFileNames: string[];
  private rootFileNames: string[];
  private readonly versions = new Map<string, number>();
  private readonly snapshots = new Map<
    string,
    { version: number; snapshot: ts.IScriptSnapshot }
  >();
  private readonly capturedTexts = new Map<string, string>();
  private readonly capturedFileSystem: CapturedFileSystem;
  private projectVersion = 0;
  private disposed = false;

  constructor(
    root: string,
    scannedSourceAbsolutePaths: readonly string[],
    capturedTexts?: ReadonlyMap<string, string>
  ) {
    const resolvedRoot = path.resolve(root);
    for (const [fileName, text] of capturedTexts ?? []) {
      this.capturedTexts.set(canonicalAbsolute(fileName), text);
    }
    this.capturedFileSystem = createCapturedFileSystem(resolvedRoot, this.capturedTexts);
    const configPath = findTsconfig(resolvedRoot, this.capturedTexts);
    const parsed = configPath ? parseTsconfig(resolvedRoot, configPath, this.capturedTexts) : null;
    this.compilerOptions = parsed ? parsed.options : { ...DEFAULT_OPTIONS };
    this.tsconfigPath = configPath;
    this.configuredFileNames = (parsed?.fileNames ?? [])
      .map((file) => path.resolve(file))
      .filter((file) => capturedTexts === undefined || this.capturedTexts.has(canonicalAbsolute(file)));
    this.rootFileNames = this.computeRootFileNames(scannedSourceAbsolutePaths);
    for (const fileName of this.rootFileNames) {
      this.versions.set(this.canonicalFileName(fileName), 0);
    }
    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => this.rootFileNames,
      getScriptVersion: (fileName) => String(this.versions.get(this.canonicalFileName(fileName)) ?? 0),
      getScriptSnapshot: (fileName) => this.scriptSnapshot(fileName),
      getProjectVersion: () => String(this.projectVersion),
      getCurrentDirectory: () => resolvedRoot,
      getCompilationSettings: () => this.compilerOptions,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: this.capturedFileSystem.fileExists,
      readFile: this.capturedFileSystem.readFile,
      readDirectory: this.capturedFileSystem.readDirectory,
      directoryExists: this.capturedFileSystem.directoryExists,
      getDirectories: this.capturedFileSystem.getDirectories
    };
    this.languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
    this.root = resolvedRoot;
  }

  private canonicalFileName(fileName: string): string {
    return canonicalAbsolute(fileName);
  }

  private computeRootFileNames(scannedSourceAbsolutePaths: readonly string[]): string[] {
    const allowJs =
      this.compilerOptions.allowJs === true || this.compilerOptions.checkJs === true;
    const compatible = (file: string): boolean => {
      const extension = path.extname(file).toLowerCase();
      if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
        return allowJs;
      }
      return [".ts", ".tsx", ".mts", ".cts"].includes(extension);
    };
    return [...new Set([
      ...this.configuredFileNames,
      ...scannedSourceAbsolutePaths.filter(compatible).map((file) => path.resolve(file))
    ])].sort();
  }

  private scriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    const resolved = path.resolve(fileName);
    const canonical = this.canonicalFileName(resolved);
    const version = this.versions.get(canonical) ?? 0;
    const cached = this.snapshots.get(canonical);
    if (cached?.version === version) {
      return cached.snapshot;
    }
    const text = this.capturedTexts.get(canonical) ?? ts.sys.readFile(resolved);
    if (text === undefined) {
      this.snapshots.delete(canonical);
      return undefined;
    }
    const snapshot = ts.ScriptSnapshot.fromString(text);
    this.snapshots.set(canonical, { version, snapshot });
    return snapshot;
  }

  private currentServices(): ProjectServices {
    if (this.disposed) {
      throw new Error("IncrementalProjectServices has been disposed");
    }
    const program = this.languageService.getProgram();
    if (!program) {
      throw new Error(`LanguageService produced no program for ${this.root}`);
    }
    return {
      languageService: this.languageService,
      program,
      checker: program.getTypeChecker(),
      compilerOptions: this.compilerOptions,
      moduleResolutionHost: this.capturedFileSystem,
      rootFileNames: [...this.rootFileNames],
      tsconfigPath: this.tsconfigPath
    };
  }

  initial(): ProjectServices {
    return this.currentServices();
  }

  refresh(
    scannedSourceAbsolutePaths: readonly string[],
    changedAbsolutePaths: readonly string[],
    capturedTexts?: ReadonlyMap<string, string>
  ): ProjectRefreshResult {
    if (this.disposed) {
      throw new Error("IncrementalProjectServices has been disposed");
    }
    const nextRoots = this.computeRootFileNames(scannedSourceAbsolutePaths);
    const rootsChanged =
      nextRoots.length !== this.rootFileNames.length ||
      nextRoots.some((file, index) => file !== this.rootFileNames[index]);
    const changedFiles = [...new Set(changedAbsolutePaths.map((file) => path.resolve(file)))].sort();
    if (capturedTexts) {
      this.capturedTexts.clear();
      for (const [fileName, text] of capturedTexts) {
        this.capturedTexts.set(this.canonicalFileName(fileName), text);
      }
      this.capturedFileSystem.invalidate();
    }
    for (const fileName of changedFiles) {
      const canonical = this.canonicalFileName(fileName);
      this.versions.set(canonical, (this.versions.get(canonical) ?? 0) + 1);
      this.snapshots.delete(canonical);
    }
    if (rootsChanged) {
      this.rootFileNames = nextRoots;
      for (const fileName of nextRoots) {
        const canonical = this.canonicalFileName(fileName);
        if (!this.versions.has(canonical)) {
          this.versions.set(canonical, 0);
        }
      }
    }
    if (rootsChanged || changedFiles.length > 0) {
      this.projectVersion += 1;
    }
    return {
      services: this.currentServices(),
      changedFiles,
      projectVersion: this.projectVersion
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.snapshots.clear();
    this.languageService.dispose();
  }
}
