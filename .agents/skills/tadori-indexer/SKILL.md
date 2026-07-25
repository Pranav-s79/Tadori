---
name: tadori-indexer
description: Use for Tadori multi-language graph extraction, identity, evidence, relation, parser registry, or indexer/store-boundary changes. Do not use for unrelated code.
---

# Tadori indexer

The TypeScript compiler API and `LanguageService` remain the semantic TS/JS
adapter. Other languages feed the same graph through the central registry and
language-neutral extractor contract. Use pinned, package-local WASM grammars;
never dynamically download a grammar or execute repository code. Canonical
identities come from `packages/core`, output must remain deterministic, and
evidence lines are one-based. Keep language, extractor, capability,
derivation, origin, confidence, resolution, and unresolved reasons honest.

Dynamic calls with no provable target use unresolved nodes. Imports, references,
and calls are distinct relations; static test linkage is not runtime coverage.
Keep the legacy TS/JS suite byte-compatible and add separate mixed-language
oracles. A parser failure must be file/language-scoped and must not discard
unaffected results. The store remains independent of parser implementations.

Recursive self-referencing symbols may fail Stage-B rename matching because a
body hash changes with the name; the raw-diff fallback is intentional. Preserve
this behavior rather than disguising it as a certain match.
