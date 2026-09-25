# Tadori Golden Fixtures

This package preserves the legacy TS/JS golden fixtures as regression coverage
under the active multi-language transition contract. It is not a product-scope
or language-support authority.

## Contents

- `GOLDEN_FIXTURE_SPEC.md` — normative human-readable fixture contract
- `fixture-manifest.json` — machine-readable fixture inventory and counts
- `schemas/expected-graph.schema.json` — complete expected-graph schema
- `schemas/expected-diff.schema.json` — raw/coalesced diff schema
- `packages/fixtures/01-core-symbols` — TypeScript core graph fixture
- `packages/fixtures/02-express-routes` — Express routing fixture
- `packages/fixtures/03-next-routes` — Next.js routing fixture
- `packages/fixtures/04-diff-coalescing` — before/after diff micro-fixture

## Validate the artifact

`pnpm test` runs the harness suite, which validates the fixture schemas, hashes
and evidence anchors and compares each indexed fixture against its expected
graph.

Type-check the synthetic repositories:

```bash
for d in   packages/fixtures/01-core-symbols/repo   packages/fixtures/02-express-routes/repo   packages/fixtures/03-next-routes/repo   packages/fixtures/04-diff-coalescing/before   packages/fixtures/04-diff-coalescing/after
do
  (cd "$d" && tsc -p tsconfig.json --noEmit)
done
```

All fixture repositories are deliberately small and contain fewer than 30 files.
