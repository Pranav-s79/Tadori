import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

import { Language, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const ALLOWED_PARSERS = new Map([
  ["python", "tree-sitter-python"],
  ["c", "tree-sitter-c"],
  ["cpp", "tree-sitter-cpp"],
  ["go", "tree-sitter-go"],
  ["rust", "tree-sitter-rust"],
  ["java", "tree-sitter-java"]
]);
const manifest = JSON.parse(readFileSync(new URL("../grammars.json", import.meta.url), "utf8"));

function serialize(node, fieldName = null) {
  return {
    type: node.type,
    fieldName,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startRow: node.startPosition.row,
    startColumn: node.startPosition.column,
    endRow: node.endPosition.row,
    endColumn: node.endPosition.column,
    isError: node.isError,
    isMissing: node.isMissing,
    children: node.namedChildren.map((child, index) =>
      serialize(child, node.fieldNameForNamedChild(index))
    )
  };
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function verifyArtifact(file, expectedSha256, label) {
  const actual = sha256(file);
  if (actual !== expectedSha256) {
    throw new Error(`${label} checksum mismatch: expected ${expectedSha256}, received ${actual}`);
  }
}

function packageMetadata(packageJson) {
  const parsed = JSON.parse(readFileSync(packageJson, "utf8"));
  if (typeof parsed !== "object" || parsed === null || typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new Error(`Invalid package metadata at ${packageJson}`);
  }
  return parsed;
}

function resolveGrammar(language, parserId) {
  const packageJson = require.resolve("tree-sitter-wasms/package.json");
  const packageRoot = realpathSync(path.dirname(packageJson));
  const metadata = packageMetadata(packageJson);
  const entry = Array.isArray(manifest.grammars)
    ? manifest.grammars.find((candidate) => candidate.language === language)
    : undefined;
  if (
    entry === undefined ||
    entry.package !== metadata.name ||
    entry.version !== metadata.version ||
    typeof entry.file !== "string" ||
    typeof entry.sha256 !== "string"
  ) {
    throw new Error(`Grammar manifest does not match installed parser package for ${language}`);
  }
  const grammar = realpathSync(path.join(packageRoot, entry.file));
  const relative = path.relative(packageRoot, grammar);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Resolved grammar escapes package root: ${grammar}`);
  }
  if (path.basename(grammar) !== `${parserId}.wasm`) {
    throw new Error(`Grammar manifest file does not match parser ${parserId}`);
  }
  verifyArtifact(grammar, entry.sha256, `${language} grammar`);
  return grammar;
}

function resolveRuntime() {
  const runtime = realpathSync(fileURLToPath(import.meta.resolve("web-tree-sitter/tree-sitter.wasm")));
  const packageRoot = path.dirname(runtime);
  const metadata = packageMetadata(path.join(packageRoot, "package.json"));
  const entry = manifest.runtime;
  if (
    typeof entry !== "object" ||
    entry === null ||
    entry.package !== metadata.name ||
    entry.version !== metadata.version ||
    entry.file !== path.basename(runtime) ||
    typeof entry.sha256 !== "string"
  ) {
    throw new Error("Grammar manifest does not match installed web-tree-sitter runtime");
  }
  verifyArtifact(runtime, entry.sha256, "web-tree-sitter runtime");
  return runtime;
}

async function main() {
  const raw = readFileSync(0, "utf8");
  const request = JSON.parse(raw);
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.language !== "string" ||
    typeof request.parserId !== "string" ||
    typeof request.source !== "string"
  ) {
    throw new Error("Invalid tree-sitter worker request");
  }
  const expectedParser = ALLOWED_PARSERS.get(request.language);
  if (expectedParser === undefined || expectedParser !== request.parserId) {
    throw new Error(`Parser ${request.parserId} is not registered for ${request.language}`);
  }

  const runtimeWasm = resolveRuntime();
  await Parser.init({ locateFile: () => runtimeWasm });
  const language = await Language.load(resolveGrammar(request.language, request.parserId));
  const parser = new Parser();
  let tree = null;
  try {
    parser.setLanguage(language);
    tree = parser.parse(request.source);
    if (tree === null) throw new Error("Parser returned no syntax tree");
    const root = serialize(tree.rootNode);
    process.stdout.write(JSON.stringify({
      ok: true,
      result: { language: request.language, root, hasErrors: tree.rootNode.hasError }
    }));
  } finally {
    if (tree !== null) tree.delete();
    parser.delete();
  }
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  }));
  process.exitCode = 0;
});
