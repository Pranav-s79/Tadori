import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { LanguageId, LanguageRegistration } from "./languageRegistry.js";

export interface StructuralSyntaxNode {
  type: string;
  fieldName: string | null;
  startIndex: number;
  endIndex: number;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
  isError: boolean;
  isMissing: boolean;
  children: StructuralSyntaxNode[];
}

export interface StructuralParseResult {
  language: LanguageId;
  root: StructuralSyntaxNode;
  hasErrors: boolean;
}

interface WorkerSuccess {
  ok: true;
  result: StructuralParseResult;
}

interface WorkerFailure {
  ok: false;
  error: string;
}

type WorkerResponse = WorkerSuccess | WorkerFailure;

export class TreeSitterRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreeSitterRuntimeError";
  }
}

/**
 * Synchronous boundary for the existing synchronous indexer. Parsing happens in
 * a short-lived Node process so asynchronous WASM initialization cannot leak
 * into callers and all parser/tree resources are reclaimed when it exits.
 */
export function parseStructuralSourceSync(
  registration: LanguageRegistration,
  source: string,
  timeoutMs = 30_000
): StructuralParseResult {
  if (registration.capability !== "structural" || registration.parserId === null) {
    throw new TreeSitterRuntimeError(
      `Language ${registration.id} does not have a structural parser registration`
    );
  }

  const workerPath = fileURLToPath(new URL("./treeSitterWorker.mjs", import.meta.url));
  const request = JSON.stringify({
    language: registration.id,
    parserId: registration.parserId,
    source
  });
  const completed = spawnSync(process.execPath, [workerPath], {
    input: request,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: Math.max(16 * 1024 * 1024, Buffer.byteLength(source, "utf8") * 24)
  });

  if (completed.error !== undefined) {
    throw new TreeSitterRuntimeError(
      `Tree-sitter worker failed for ${registration.id}: ${completed.error.message}`
    );
  }
  if (completed.status !== 0) {
    const detail = completed.stderr.trim() || `exit status ${String(completed.status)}`;
    throw new TreeSitterRuntimeError(`Tree-sitter worker failed for ${registration.id}: ${detail}`);
  }

  let response: WorkerResponse;
  try {
    response = JSON.parse(completed.stdout) as WorkerResponse;
  } catch (error) {
    throw new TreeSitterRuntimeError(
      `Tree-sitter worker returned invalid JSON for ${registration.id}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!response.ok) {
    throw new TreeSitterRuntimeError(`Tree-sitter parse failed for ${registration.id}: ${response.error}`);
  }
  if (response.result.language !== registration.id) {
    throw new TreeSitterRuntimeError(
      `Tree-sitter worker returned language ${response.result.language} for ${registration.id}`
    );
  }
  return response.result;
}
