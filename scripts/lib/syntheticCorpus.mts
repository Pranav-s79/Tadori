import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface SyntheticCorpusOptions {
  leafFileCount: number;
  linesPerLeafFile: number;
  chainFileCount: number;
}

export interface SyntheticCorpus {
  root: string;
  sourceRoot: string;
  approximateLoc: number;
  fileCount: number;
  writeLeaf(index: number, revision: number): void;
  writeChain(index: number, revision: number): void;
  writeBarrel(startIndex?: number): void;
}

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

/** Single authoritative TypeScript corpus shape shared by all performance gates. */
export function createSyntheticCorpus(
  root: string,
  options: SyntheticCorpusOptions
): SyntheticCorpus {
  requirePositiveInteger("leafFileCount", options.leafFileCount);
  requirePositiveInteger("linesPerLeafFile", options.linesPerLeafFile);
  requirePositiveInteger("chainFileCount", options.chainFileCount);
  if (options.linesPerLeafFile < 2) {
    throw new Error("linesPerLeafFile must be at least 2");
  }

  const sourceRoot = path.join(root, "src");
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(path.join(root, "package.json"), '{"name":"benchmark-corpus"}\n');
  writeFileSync(
    path.join(root, "tsconfig.json"),
    '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","strict":true},"include":["src"]}\n'
  );

  const writeLeaf = (index: number, revision: number): void => {
    const comments = Array.from(
      { length: options.linesPerLeafFile - 2 },
      (_, line) => `// corpus ${index} line ${line}`
    );
    const name = `value${String(index).padStart(3, "0")}`;
    writeFileSync(
      path.join(sourceRoot, `f${String(index).padStart(3, "0")}.ts`),
      [...comments, `export function ${name}(): number { return ${revision}; }`, ""].join("\n")
    );
  };

  const writeChain = (index: number, revision: number): void => {
    const next = index + 1;
    const source = next < options.chainFileCount
      ? `import { chain${next} } from "./chain${next}.js";\nexport function chain${index}(): number { return chain${next}(); }\n`
      : `export function chain${index}(): number { return ${revision}; }\n`;
    writeFileSync(path.join(sourceRoot, `chain${index}.ts`), source);
  };

  const writeBarrel = (startIndex = 0): void => {
    const exports = Array.from(
      { length: options.leafFileCount - startIndex },
      (_, offset) => startIndex + offset
    ).map((index) =>
      `export { value${String(index).padStart(3, "0")} } from "./f${String(index).padStart(3, "0")}.js";`
    );
    writeFileSync(path.join(sourceRoot, "index.ts"), `${exports.join("\n")}\n`);
  };

  for (let index = 0; index < options.leafFileCount; index += 1) writeLeaf(index, 0);
  for (let index = 0; index < options.chainFileCount; index += 1) writeChain(index, 0);
  writeBarrel();

  return {
    root,
    sourceRoot,
    approximateLoc:
      options.leafFileCount * options.linesPerLeafFile
      + options.chainFileCount * 2
      + options.leafFileCount,
    fileCount: options.leafFileCount + options.chainFileCount + 1,
    writeLeaf,
    writeChain,
    writeBarrel
  };
}
