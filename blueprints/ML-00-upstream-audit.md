# ML-00 — Upstream architecture, license, and reuse audit

Observed 2026-07-24. No upstream code or artifact has been copied.

## Pins and licenses

| Source | Audited commit | License | Use |
|---|---|---|---|
| Understand Anything | `6ae71878beb50226a1e4b7e2f52ac6468c86f74b` | MIT; Copyright 2026 Yuxiang Lin and Infinite Universe, Inc. | Architecture reference |
| Tree-sitter | `3a76a8c8cab0b4a97c9f828af51a6a758e9110cb` | MIT | Parser/runtime reference |
| GoogleCloudPlatform/microservices-demo | `9a4616e77f0f9cbcbecaf27d711c38890dda1404` | Apache-2.0 | Pinned mixed-language validation input |
| protocolbuffers/protobuf | `44fa35f8607515ce7172ed7e96829cd7e45a71f7` | BSD-style repository license | Pinned C/C++ validation input |

Primary records: Understand Anything [`LICENSE`](https://github.com/Lum1104/Understand-Anything/blob/6ae71878beb50226a1e4b7e2f52ac6468c86f74b/LICENSE) and [`CLAUDE.md`](https://github.com/Lum1104/Understand-Anything/blob/6ae71878beb50226a1e4b7e2f52ac6468c86f74b/CLAUDE.md); Tree-sitter [`LICENSE`](https://github.com/tree-sitter/tree-sitter/blob/3a76a8c8cab0b4a97c9f828af51a6a758e9110cb/LICENSE); microservices-demo [`LICENSE`](https://github.com/GoogleCloudPlatform/microservices-demo/blob/9a4616e77f0f9cbcbecaf27d711c38890dda1404/LICENSE); protobuf [`LICENSE`](https://github.com/protocolbuffers/protobuf/blob/44fa35f8607515ce7172ed7e96829cd7e45a71f7/LICENSE).

If Tadori later directly copies or substantially adapts Understand Anything
code, its MIT copyright and permission text must be retained in third-party
notices. This implementation plan requires no direct copy.

## Examined architecture and reuse classification

`IRC` means independently reimplemented concept; `SA` means substantially
adapted; `DC` means directly copied.

| Concern | Exact upstream paths at the audited SHA | Classification and finding |
|---|---|---|
| Language detection | `understand-anything-plugin/packages/core/src/languages/{types.ts,language-registry.ts,configs/*.ts}` | IRC. Filename precedes extension, but collision ownership silently overwrites and capability/version/shebang/generated metadata are absent. |
| Mixed scan/ignore | `skills/understand/scan-project.mjs`; `packages/core/src/{ignore-filter.ts,ignore-generator.ts}` | IRC. Useful cases, but a second hard-coded language map violates Tadori's one-registry requirement. |
| Plugin registry | `packages/core/src/plugins/{registry.ts,discovery.ts,extractors/types.ts,extractors/index.ts,parsers/index.ts}` | IRC. Later registration silently wins and malformed config falls back; Tadori requires explicit precedence and diagnostics. |
| WASM runtime | `packages/core/src/plugins/tree-sitter-plugin.ts`; language `configs/*.ts` | Independently implement the package-local loading topology. Upstream caches parsers but swallows grammar errors, has an inaccurate TSX fallback, lacks a close API, and does not prove shared-parser concurrency. |
| Structural extractors | `packages/core/src/plugins/extractors/{base,typescript,python,go,rust,java,ruby,php,cpp,csharp,dart,kotlin,swift,scala}-extractor.ts` | IRC. Direct AST walking is useful as reference, but calls are syntax names rather than symbol facts and the graph/provenance/identity contracts differ. |
| Import resolution | `skills/understand/extract-import-map.mjs` | IRC. Large heuristic resolver; Tadori must attach evidence and honest resolution. |
| Framework detection | `packages/core/src/languages/framework-registry.ts`; `languages/frameworks/*.ts` | IRC. Preserve Tadori's route semantics and confidence. |
| Non-code parsers | `packages/core/src/plugins/parsers/{markdown,yaml,json,toml,env,dockerfile,sql,graphql,protobuf,terraform,makefile,shell}-parser.ts` | IRC. Mostly regex/ad-hoc and several are explicitly incomplete. |
| Fingerprints | `packages/core/src/fingerprint.ts`; `skills/understand/build-fingerprints.mjs` | IRC. Preserve Tadori body hashes, keys, snapshots, and diffs. Upstream output includes `generatedAt` and is not wholly byte-deterministic. |
| Failure isolation | `tree-sitter-plugin.ts`; `skills/understand/{extract-structure-result.mjs,extract-import-map.mjs,scan-project.mjs}` | IRC. Upstream outcome wrappers discard error detail; Tadori needs scoped diagnostics and unaffected-language success. |
| Referential integrity | `packages/core/src/analyzer/normalize-graph.ts`; `packages/core/src/schema.ts` | IRC assertions only. Upstream drops invalid edges; Tadori must fail validation on dangling endpoints. |

There are no upstream Tree-sitter query bundles or corpus tests: repository
search found no `.scm`, `Query`, `captures`, or query invocation. Tadori query
bundles and tests must therefore be original and follow the official
[Tree-sitter corpus format](https://tree-sitter.github.io/tree-sitter/creating-parsers/5-writing-tests.html).

## Supply-chain decision

The runtime and grammar packages will be exact-pinned in the pnpm lockfile;
normal indexing will never download grammars or execute repository code.
Packed artifacts must contain the required WASM files and a checksum/provenance
manifest. Parser initialization, grammar failure, malformed input, concurrency,
memory, Node 22/24/26, Windows/Linux, and shutdown behavior are explicit gates.

Understand Anything currently resolves `web-tree-sitter` 0.26.8 and multiple
grammar packages through lockfile integrity records, but its manifests use
semver ranges and two vendored grammar build notes are not fully reproducible.
No upstream binaries will be reused without independent license, pin, and
checksum evidence.

