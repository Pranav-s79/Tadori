import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { build } from "esbuild";

const root = process.cwd();
const outputRoot = path.join(root, "dist", "package");
const binRoot = path.join(outputRoot, "bin");

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(binRoot, { recursive: true });

const external = [
  "@fastify/websocket",
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/sdk/*",
  "better-sqlite3",
  "fastify",
  "graphology",
  "graphology-layout-forceatlas2",
  "open",
  "tree-sitter-wasms",
  "tree-sitter-wasms/*",
  "typescript",
  "web-tree-sitter",
  "zod"
];

await build({
  entryPoints: [path.join(root, "packages", "cli", "src", "cli.ts")],
  outfile: path.join(binRoot, "tadori.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  external
});
await build({
  entryPoints: [path.join(root, "packages", "mcp", "src", "refreshWorker.ts")],
  outfile: path.join(binRoot, "refreshWorker.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external
});

cpSync(path.join(root, "packages", "indexer", "src", "treeSitterWorker.mjs"), path.join(binRoot, "treeSitterWorker.mjs"));
cpSync(path.join(root, "packages", "indexer", "grammars.json"), path.join(outputRoot, "grammars.json"));
cpSync(path.join(root, "apps", "viz", "dist"), path.join(outputRoot, "viz"), { recursive: true });

const cliPackage = JSON.parse(readFileSync(path.join(root, "packages", "cli", "package.json"), "utf8"));
const packageJson = {
  name: "tadori",
  version: cliPackage.version,
  description: "Deterministic local multi-language repository intelligence",
  type: "module",
  engines: { node: ">=22" },
  bin: { tadori: "bin/tadori.mjs" },
  files: ["bin", "grammars.json", "viz"],
  dependencies: {
    "@fastify/websocket": "^11.0.0",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "better-sqlite3": "^12.11.1",
    fastify: "^5.0.0",
    graphology: "0.26.0",
    "graphology-layout-forceatlas2": "0.10.1",
    open: "^10.1.0",
    "tree-sitter-wasms": "0.1.13",
    typescript: "^5.5.3",
    "web-tree-sitter": "0.25.10",
    zod: "^3.23.8"
  },
  license: "UNLICENSED"
};
writeFileSync(path.join(outputRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
