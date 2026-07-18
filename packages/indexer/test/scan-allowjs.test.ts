import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  IncrementalRepositoryIndexer,
  indexRepository,
  scanRepository
} from "@tadori/indexer";
import { openDatabase, runMigrations, type Database } from "@tadori/store";

let repo: string | null = null;
let db: Database | null = null;
const controllers: IncrementalRepositoryIndexer[] = [];

afterEach(async () => {
  for (const controller of controllers.splice(0)) {
    await controller.stop();
  }
  db?.close();
  db = null;
  if (repo) {
    rmSync(repo, { recursive: true, force: true });
    repo = null;
  }
});

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tadori-scan-allowjs-"));
  repo = dir;
  return dir;
}

describe("scanRepository allowJs gate", () => {
  it("(a) gates off a JS file matched by an include glob when allowJs is absent", () => {
    const root = makeRepo();
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), '{"name":"scan-a"}\n');
    writeFileSync(
      path.join(root, "tsconfig.json"),
      '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","strict":true},"include":["src/**/*.ts","**/*.js"]}\n'
    );
    writeFileSync(path.join(root, "tool.config.js"), "module.exports = {};\n");
    writeFileSync(
      path.join(root, "src", "a.ts"),
      "export function a(): number { return 1; }\n"
    );

    const scan = scanRepository(root);
    const jsFile = scan.supportFiles.find((f) => f.normalizedPath === "tool.config.js");
    expect(jsFile).toMatchObject({ indexed: false, language: "javascript" });
    expect(scan.indexedFiles.some((f) => f.normalizedPath === "tool.config.js")).toBe(false);

    const result = indexRepository(root, { kind: "working_tree" });
    expect(result.graph.files.some((f) => f.normalizedPath === "tool.config.js")).toBe(false);
    expect(
      result.graph.nodes.some((n) => n.kind === "file" && n.file === "tool.config.js")
    ).toBe(false);

    const union = new Set([
      ...scan.indexedFiles.map((f) => f.normalizedPath),
      ...scan.supportFiles.map((f) => f.normalizedPath)
    ]);
    expect(union.has("tool.config.js")).toBe(true);
  });

  it("(b) includes a .js file in indexedFiles and extracts its function when allowJs is true", () => {
    const root = makeRepo();
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), '{"name":"scan-b"}\n');
    writeFileSync(
      path.join(root, "tsconfig.json"),
      '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","allowJs":true,"checkJs":false},"include":["src"]}\n'
    );
    writeFileSync(
      path.join(root, "src", "util.js"),
      "export function util() { return 1; }\n"
    );

    const scan = scanRepository(root);
    expect(scan.indexedFiles.some((f) => f.normalizedPath === "src/util.js")).toBe(true);
    expect(scan.supportFiles.some((f) => f.normalizedPath === "src/util.js")).toBe(false);

    const result = indexRepository(root, { kind: "working_tree" });
    expect(
      result.graph.nodes.some((n) => n.kind === "file" && n.file === "src/util.js")
    ).toBe(true);
    expect(
      result.graph.nodes.some(
        (n) => n.kind === "function" && n.file === "src/util.js" && n.displayName === "util"
      )
    ).toBe(true);
  });

  it("(b2) applies the same JS_EXTENSIONS gate to .jsx, .mjs, and .cjs", () => {
    const rootOn = makeRepo();
    mkdirSync(path.join(rootOn, "src"), { recursive: true });
    writeFileSync(path.join(rootOn, "package.json"), '{"name":"scan-b2-on"}\n');
    writeFileSync(
      path.join(rootOn, "tsconfig.json"),
      '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","allowJs":true},"include":["src"]}\n'
    );
    writeFileSync(path.join(rootOn, "src", "comp.jsx"), "export const Comp = () => null;\n");
    writeFileSync(path.join(rootOn, "src", "mod.mjs"), "export const mod = 1;\n");
    writeFileSync(path.join(rootOn, "src", "mod.cjs"), "module.exports = { mod: 1 };\n");
    const scanOn = scanRepository(rootOn);
    for (const rel of ["src/comp.jsx", "src/mod.mjs", "src/mod.cjs"]) {
      expect(scanOn.indexedFiles.some((f) => f.normalizedPath === rel)).toBe(true);
      expect(scanOn.supportFiles.some((f) => f.normalizedPath === rel)).toBe(false);
    }
    rmSync(rootOn, { recursive: true, force: true });
    repo = null;

    const rootOff = makeRepo();
    mkdirSync(path.join(rootOff, "src"), { recursive: true });
    writeFileSync(path.join(rootOff, "package.json"), '{"name":"scan-b2-off"}\n');
    writeFileSync(
      path.join(rootOff, "tsconfig.json"),
      '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"},"include":["src"]}\n'
    );
    writeFileSync(path.join(rootOff, "src", "comp.jsx"), "export const Comp = () => null;\n");
    writeFileSync(path.join(rootOff, "src", "mod.mjs"), "export const mod = 1;\n");
    writeFileSync(path.join(rootOff, "src", "mod.cjs"), "module.exports = { mod: 1 };\n");
    // A .ts input keeps the tsconfig's `include: ["src"]` non-empty for
    // TypeScript's own parse (a JS-only `include` with allowJs off is a
    // fatal "No inputs were found" tsconfig error, unrelated to the gate
    // under test).
    writeFileSync(
      path.join(rootOff, "src", "anchor.ts"),
      "export const anchor = 1;\n"
    );
    const scanOff = scanRepository(rootOff);
    for (const rel of ["src/comp.jsx", "src/mod.mjs", "src/mod.cjs"]) {
      expect(scanOff.supportFiles.some((f) => f.normalizedPath === rel)).toBe(true);
      expect(scanOff.indexedFiles.some((f) => f.normalizedPath === rel)).toBe(false);
    }
  });

  it("(c) resolves allowJs:true from an extended base tsconfig", () => {
    const root = makeRepo();
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), '{"name":"scan-c"}\n');
    writeFileSync(
      path.join(root, "tsconfig.base.json"),
      '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","allowJs":true}}\n'
    );
    writeFileSync(
      path.join(root, "tsconfig.json"),
      '{"extends":"./tsconfig.base.json","include":["src"]}\n'
    );
    writeFileSync(
      path.join(root, "src", "util.js"),
      "export function util() { return 1; }\n"
    );

    const scan = scanRepository(root);
    expect(scan.indexedFiles.some((f) => f.normalizedPath === "src/util.js")).toBe(true);
    expect(scan.supportFiles.some((f) => f.normalizedPath === "src/util.js")).toBe(false);
  });

  it("(d) treats checkJs:true without allowJs as JS-enabled", () => {
    const root = makeRepo();
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), '{"name":"scan-d"}\n');
    writeFileSync(
      path.join(root, "tsconfig.json"),
      '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","checkJs":true},"include":["src"]}\n'
    );
    writeFileSync(
      path.join(root, "src", "util.js"),
      "export function util() { return 1; }\n"
    );

    const scan = scanRepository(root);
    expect(scan.indexedFiles.some((f) => f.normalizedPath === "src/util.js")).toBe(true);
    expect(scan.supportFiles.some((f) => f.normalizedPath === "src/util.js")).toBe(false);
  });

  it("(e) gates JS off with no tsconfig at all", () => {
    const root = makeRepo();
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), '{"name":"scan-e"}\n');
    writeFileSync(
      path.join(root, "src", "util.js"),
      "export function util() { return 1; }\n"
    );

    const scan = scanRepository(root);
    expect(scan.supportFiles.some((f) => f.normalizedPath === "src/util.js")).toBe(true);
    expect(scan.indexedFiles.some((f) => f.normalizedPath === "src/util.js")).toBe(false);

    const result = indexRepository(root, { kind: "working_tree" });
    expect(result.graph).toBeDefined();
  });

  it("(f) leaves .d.ts classification unchanged regardless of allowJs", () => {
    const root = makeRepo();
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), '{"name":"scan-f"}\n');
    writeFileSync(
      path.join(root, "tsconfig.json"),
      '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","allowJs":true},"include":["src"]}\n'
    );
    writeFileSync(path.join(root, "src", "shim.d.ts"), "declare const shim: number;\n");

    const scan = scanRepository(root);
    const shim = scan.supportFiles.find((f) => f.normalizedPath === "src/shim.d.ts");
    expect(shim).toMatchObject({ indexed: false, language: "typescript" });
    expect(scan.indexedFiles.some((f) => f.normalizedPath === "src/shim.d.ts")).toBe(false);
  });

  it("(g) refreshes successfully when a gated-off support JS file is edited", async () => {
    const root = makeRepo();
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), '{"name":"scan-g"}\n');
    writeFileSync(
      path.join(root, "tsconfig.json"),
      '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","strict":true},"include":["src","tool.config.js"]}\n'
    );
    writeFileSync(
      path.join(root, "src", "value.ts"),
      "export function value(): number { return 1; }\n"
    );
    writeFileSync(path.join(root, "tool.config.js"), "module.exports = { flag: false };\n");

    db = openDatabase(":memory:");
    runMigrations(db);
    const indexer = new IncrementalRepositoryIndexer(db, root);
    controllers.push(indexer);
    await indexer.initialize();
    await indexer.waitForIdle();
    const initialSnapshotId = indexer.state().snapshotId;
    expect(initialSnapshotId).not.toBeNull();

    writeFileSync(path.join(root, "tool.config.js"), "module.exports = { flag: true };\n");
    const state = await indexer.refresh([{ path: "tool.config.js", kind: "change" }]);

    expect(state.phase).toBe("idle");
    expect(state.lastError).toBeNull();
    expect(state.snapshotId).not.toBeNull();
    // The support-file edit changes the workspace hash, so the refresh must
    // publish a new snapshot rather than silently no-oping.
    expect(state.snapshotId).not.toBe(initialSnapshotId);
  });
});
