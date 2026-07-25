# Tadori multi-language repository intelligence contract

**Status:** Active  
**Effective:** 2026-07-24  
**Supersedes:** Tadori v2.1 scope and schema restrictions

## Product outcome

Tadori ingests repositories containing any combination of languages into one
evidence-backed graph, store, snapshot, diff, API, and visualization model.
Every safe text file can participate at repository level. Registered bundled
grammars add deterministic structural extraction. Qualified semantic engines
may add semantic resolution for selected languages.

Support is never a Boolean. Every language and feature is reported as
`semantic`, `structural`, `repository-only`, `unsupported`, or `experimental`
through `docs/MULTILANGUAGE_CAPABILITIES.json`.

## Required architecture

1. One deterministic language registry owns IDs, extensions, filenames,
   shebangs, precedence, generated conventions, parser/extractor versions,
   manifests, capability, and query bundles.
2. One language-neutral extractor contract emits canonical Tadori nodes,
   edges, evidence, diagnostics, projects, unresolved reasons, and per-item
   provenance.
3. The existing TypeScript `LanguageService` pipeline remains the semantic
   TS/JS adapter with byte-stable legacy identities.
4. Pinned package-local WASM Tree-sitter grammars provide structural adapters.
   Indexing never downloads grammars, compiles native parsers, executes target
   repositories, or sends source to an external service.
5. Parser failures are scoped. Unaffected languages still produce a valid
   snapshot; failed files produce diagnostics and repository-level fallback.
6. New-language qualified identities include a canonical language namespace;
   legacy TS/JS identities stay unchanged.
7. Existing snapshots remain readable. Schema evolution is additive and
   extractor-version changes cannot masquerade as source renames.

## Baseline bundled structural capability

The first production bundle must cover Python, C, C++, Go, Rust, and Java in
addition to semantic TypeScript/JavaScript. It must also model high-value
interface and repository files including Protocol Buffers, JSON, YAML,
Markdown, Dockerfiles, Terraform/HCL, TOML, Make/CMake, and shell files.

The registry and plugin contract must accept further languages without a graph,
store, API, snapshot, diff, or visualization migration. Unbundled languages
remain visible at repository level rather than causing repository rejection.

## Evidence and capability rules

- Compiler facts use `compiler-resolved` derivation.
- Tree-sitter facts use `parser-derived` derivation and are not labeled as
  compiler facts.
- Framework/test/project conventions use `convention-derived`.
- Repository/file/manifest facts use `repository-derived`.
- Ambiguous targets remain unresolved with an explicit reason.
- Cross-language edges require concrete route, protocol, FFI, subprocess,
  generated-binding, build, or configuration evidence. Names alone never link.

## Compatibility and validation

The former v2.1 TS/JS fixtures are a legacy regression suite and may be
extended or replaced only with evidence; they no longer limit product scope or
additive schemas. Current validation also requires a deterministic mixed-language
oracle, duplicate/dangling/span/integrity checks, parser-failure isolation,
packed-artifact installation, local server/API/visualization smoke, purge, and
pinned external repository runs recorded by invariant rather than massive
goldens.

## Public claim

> Tadori can structurally map mixed-language repositories, with deeper semantic
> analysis available for selected languages.

Do not claim universal semantic parity.
