---
name: tadori-indexer
description: Use for Tadori TypeScript graph extraction, identity, evidence, relation, or indexer/store-boundary changes. Do not use for unrelated code.
---

# Tadori indexer

The TypeScript compiler API and `LanguageService` remain the prototype engine;
do not introduce Tree-sitter or another language. Canonical identities come
from `packages/core`, output must remain deterministic, and evidence lines are
one-based. Keep origin, confidence, and resolution honest.

Dynamic calls with no provable target use unresolved nodes. Imports, references,
and calls are distinct relations; static test linkage is not runtime coverage.
Check every new extraction behavior against golden fixtures. The store remains
independent of the indexer.

Recursive self-referencing symbols may fail Stage-B rename matching because a
body hash changes with the name; the raw-diff fallback is intentional. Preserve
this behavior rather than disguising it as a certain match.
