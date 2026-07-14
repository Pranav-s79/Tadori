import { createHash } from "node:crypto";
import type { NodeKind, Relation } from "./enums.js";

/**
 * Escapes one canonical-identity field per the frozen v2.1 rule:
 * backslashes first, then pipes, so the escaped form round-trips.
 */
export function escapeIdentityField(field: string): string {
  return field.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/** Joins pre-escaped fields with the printable pipe separator. */
export function joinIdentityFields(fields: readonly string[]): string {
  return fields.map(escapeIdentityField).join("|");
}

/** File-entity origin identity: `file|<normalized path>`. */
export function fileCanonicalIdentity(normalizedPath: string): string {
  return joinIdentityFields(["file", normalizedPath]);
}

/** Node canonical identity: `node|<kind>|<qualified name>`. */
export function nodeCanonicalIdentity(kind: NodeKind, qualifiedName: string): string {
  return joinIdentityFields(["node", kind, qualifiedName]);
}

/**
 * Edge canonical identity: `edge|<source node key>|<relation>|<destination node key>`.
 * The node keys are the 64-char hex entity keys of the endpoints, matching the
 * golden fixtures and the frozen corrections document.
 */
export function edgeCanonicalIdentity(
  srcEntityKey: string,
  relation: Relation,
  dstEntityKey: string
): string {
  return joinIdentityFields(["edge", srcEntityKey, relation, dstEntityKey]);
}

/** SHA-256 hex digest of the UTF-8 bytes of `text`. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 hex digest of raw bytes (used for file content hashes). */
export function sha256HexBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Entity key for a canonical identity. When `collisionIndex` is greater than
 * zero (a true SHA-256 collision between different canonical identities), the
 * index is appended as an extra pipe-delimited field and the key is rehashed,
 * per the frozen corrections document.
 */
export function entityKey(canonicalIdentity: string, collisionIndex = 0): string {
  if (!Number.isInteger(collisionIndex) || collisionIndex < 0) {
    throw new Error(
      `collisionIndex must be a non-negative integer, got ${String(collisionIndex)}`
    );
  }
  if (collisionIndex === 0) {
    return sha256Hex(canonicalIdentity);
  }
  return sha256Hex(`${canonicalIdentity}|${collisionIndex}`);
}
