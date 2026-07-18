# BLUEPRINT [ID]: [Short name]

BUILDER: [Claude Sonnet | Claude Haiku | Codex], working alone, cold start, cannot ask questions.

MODEL CHOICE
One sentence explaining why this builder is appropriate.

## GOAL

One or two sentences stating the completed observable result.

## CURRENT REPOSITORY STATE

- Current phase:
- Relevant completed capabilities:
- Existing implementation that must be reused:
- Existing tests and fixtures:
- Known limitations:
- Dependencies on earlier blueprints:

## CONTEXT THE BUILDER NEEDS

### Files to read first

### Existing APIs and types

### Real examples

### Gotchas

## SCOPE

### Files and directories allowed to change

### New files expected

### Must not change

## ARCHITECTURAL DECISIONS

Chosen approach; rejected alternatives; reason; compatibility constraints;
persistence behavior; failure behavior; determinism requirements;
provenance/confidence requirements; security constraints. No open choices.

## DATA AND API CONTRACTS

Exact TypeScript interfaces, command syntax, event shapes, database changes,
API requests/responses, error types, configuration fields, pagination,
state transitions.

## STEP-BY-STEP IMPLEMENTATION PLAN

Numbered; each step names exact file, exact symbol, exact behavior,
dependencies on earlier steps, tests added with that step.

## TEST PLAN

### Unit tests
### Integration tests
### Fixture or golden validation
### Adversarial tests
### Performance tests
### Browser tests

## VALIDATION COMMANDS

pnpm skills:check
pnpm typecheck
pnpm lint
pnpm test
python validate_fixtures.py
pnpm fixtures:validate
pnpm fixtures:index
pnpm fixtures:typecheck
git diff --check
git status --short

## DEFINITION OF DONE

- [ ] Objectively pass/fail checkboxes only.

## REVIEW SUBAGENTS

- Specification guardian:
- Implementation reviewer:
- Test adversary:
- Performance reviewer (if applicable):
- Security/privacy reviewer (if applicable):
- UX/browser reviewer (if applicable):

## HANDOFF OUTPUT

Files changed; architecture implemented; commands run; test counts; fixture
results; performance results; remaining limitations; assumptions; commit SHA;
exact next blueprint.

## IF SOMETHING IS UNCLEAR

Make the smallest safe assumption, write `ASSUMPTION: ...` in the
implementation report, continue, do not expand scope. If the uncertainty could
violate a frozen contract, stop that item and report it as blocked.

## TADORI NON-NEGOTIABLES (every blueprint)

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools; stable 2D
default; 2.5D optional; 3D experimental; no city metaphor; no default
hairball; progressive disclosure package → file → task-region symbols; Guided
Explore clearer than free exploration; every visible relation keeps evidence,
origin, confidence, resolution; unresolved stays visibly unresolved; static
test linkage is not runtime coverage; agent observation is not complete
knowledge ("not observed inspected"); invalid snapshots never served;
`tadori serve .` is the normal command; localhost default; no cloud
dependency; Graphify is ignored reference only — never import/copy/ship; never
weaken golden fixtures; no seventh tool; no runtime tracing; no inferred
design rationale as fact.
