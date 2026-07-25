# Tadori mixed-language oracle test data

This directory is additive test data for the active multi-language transition.
It does not replace or modify the legacy TypeScript/JavaScript regression
fixtures. `expected-oracle.json` is the machine-readable contract for this
fixture; paths are slash-normalized and evidence lines are one-based.

## What the fixture exercises

- TypeScript and JavaScript semantic inputs plus Python, C, C++, Go, Rust,
  Java, and Protocol Buffer structural inputs.
- JSON, YAML, Markdown, Dockerfile, Terraform, CMake, and package-manifest
  repository/configuration evidence.
- Repeated `transform` definitions whose canonical identities must remain
  language-distinct. A shared spelling is never cross-language evidence.
- Tests, imports, named types, methods, direct calls, dynamic unresolved calls,
  comments, and file-scoped syntax recovery where those concepts apply.
- Concrete TS-to-Python HTTP, Python/Go-to-Proto generated-binding, C++-to-C
  FFI, C++-to-Python subprocess, and CMake build/link boundaries.

## Harness rules

Treat `README.md` and `expected-oracle.json` as oracle metadata, not subject
files. Never execute, compile, generate bindings for, download dependencies
for, or contact endpoints from this fixture. The malformed files under
`recovery/` are deliberate: emit file-scoped diagnostics, retain any safely
recovered declaration named in the oracle, and preserve results from every
unaffected file. YAML and Terraform malformed inputs require repository-level
fallback only.

All compiler, parser, convention, and repository provenance must remain
honest. Static test linkage is not runtime coverage, dynamic dispatch remains
unresolved, and prose or matching names alone must not create an edge.
