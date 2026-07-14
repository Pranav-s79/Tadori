# Tadori Golden Fixtures

This package implements the frozen Tadori v2.1 golden-fixture specification.

## Contents

- `GOLDEN_FIXTURE_SPEC.md` — normative human-readable fixture contract
- `fixture-manifest.json` — machine-readable fixture inventory and counts
- `schemas/expected-graph.schema.json` — complete expected-graph schema
- `schemas/expected-diff.schema.json` — raw/coalesced diff schema
- `packages/fixtures/01-core-symbols` — TypeScript core graph fixture
- `packages/fixtures/02-express-routes` — Express routing fixture
- `packages/fixtures/03-next-routes` — Next.js routing fixture
- `packages/fixtures/04-diff-coalescing` — before/after diff micro-fixture
- `validate_fixtures.py` — validates schemas, hashes, endpoints, and evidence anchors

## Validate the artifact

```bash
python validate_fixtures.py
```

Type-check the synthetic repositories:

```bash
for d in   packages/fixtures/01-core-symbols/repo   packages/fixtures/02-express-routes/repo   packages/fixtures/03-next-routes/repo   packages/fixtures/04-diff-coalescing/before   packages/fixtures/04-diff-coalescing/after
do
  (cd "$d" && tsc -p tsconfig.json --noEmit)
done
```

All fixture repositories are deliberately small and contain fewer than 30 files.
