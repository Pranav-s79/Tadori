# BLUEPRINT [ID]: [Title]

## 1. Header

- ID / Title / Phase:
- Status: (pending | drafting | review | ready | built | validated | blocked)
- Primary builder: (Claude Sonnet | Claude Opus | Codex | Claude Haiku) + one-line model rationale
- Reviewer roles:
- Complexity: S / M / L (one focused builder session)
- Depends on / Unlocks: (blueprint IDs)
- Estimated sessions:
- Related frozen-spec sections:

## 2. Objective

What becomes true when this blueprint is complete (one or two sentences,
observable).

## 3. Why this matters

User value; system value; downstream dependency value.

## 4. Current repository evidence

Exact existing files, packages, exports, schemas, commands, tests, fixtures,
migrations, docs, constraints — with paths (and line refs for code). Separate
**verified current** from **PROPOSED** items. List files to read first and
gotchas.

## 5. Scope

All included behaviors.

## 6. Non-goals

Explicitly excluded adjacent work.

## 7. Dependencies and prerequisites

Blueprint IDs plus the exact contracts they must have delivered.

## 8. Architectural decisions

Resolved before implementation: package ownership; data flow; state
ownership; persistence; lifecycle; concurrency; APIs; compatibility;
security; privacy; performance; accessibility; failure semantics. Chosen
approach + rejected alternatives + reasons. No open choices left to the
builder.

## 9. Exact file plan

Per file: full path; create/modify/move/delete; responsibility; key exports;
key imports; integration points; relevant tests.

## 10. Exact contracts

Concrete proposed TypeScript interfaces/types/classes/functions; CLI syntax;
HTTP endpoints; WebSocket messages; config keys; DB tables/migrations;
events; React state; graph payloads; error codes; status enums. Code-shaped
examples where useful.

## 11. Ordered implementation procedure

Strict numbered steps. Each step: exact files; exact behavior; reason; test
added immediately; expected intermediate result.

## 12. Data and lifecycle flows

Startup, operation, refresh, failure, retry, shutdown. Text sequence
diagrams where useful.

## 13. Test plan

Applicable: unit / integration / fixture / migration / API / WebSocket / CLI
/ browser / accessibility / performance / cross-platform / adversarial /
regression. Name proposed test files and exact assertions.

## 14. Acceptance criteria

Binary and verifiable only. No "polished / robust / works correctly /
user friendly / production ready".

## 15. Validation commands

Preserve all applicable repository gates (pnpm install or frozen-lockfile,
skills:sync, skills:check, typecheck, lint, test, python
validate_fixtures.py, fixtures:validate, fixtures:index, fixtures:typecheck,
applicable benchmarks, browser/a11y tests, git diff --check) plus
blueprint-specific commands.

## 16. Performance budgets

Measurable latency / memory / graph-size / rendering / response limits where
relevant.

## 17. Failure and recovery behavior

Malformed input; stale data; interrupted operations; invalid snapshots;
corrupt storage; browser disconnection; watcher failure; port collision;
partial event streams; unsupported repositories; retry and cleanup.

## 18. Security and privacy

Localhost binding; path confinement; sensitive content; redaction;
retention; purge; safe deep links; untrusted event payloads.

## 19. Accessibility

(Human-facing work.) Keyboard behavior; focus order; screen-reader text;
reduced motion; contrast; non-canvas fallback; textual process
representation.

## 20. Documentation updates

Exact documentation files to modify.

## 21. Builder final report

Require: summary; files changed; contracts implemented; tests added;
validation results; benchmark evidence; screenshots where applicable; commit
SHA; known limitations; follow-on risks; `ASSUMPTION:` lines.

## 22. Independent review result

Reviewer role; blocker findings; high-severity findings; corrections made;
final review status. A blueprint is `ready` only after blockers and
high-severity findings are resolved.

## IF SOMETHING IS UNCLEAR

Make the smallest safe assumption, record `ASSUMPTION: ...` in the report,
continue without expanding scope. If the uncertainty could violate a frozen
contract, stop that item and report blocked.

## TADORI NON-NEGOTIABLES (every blueprint)

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools; stable 2D
default; 2.5D optional; 3D experimental only; no city metaphor; no default
hairball; no generic admin dashboard or permanent dual sidebars; progressive
disclosure package → file → task-region symbols; deterministic positions;
every visible relation keeps evidence, origin, confidence, resolution;
unresolved stays visibly unresolved; static test linkage is not runtime
coverage; agent observation honesty ("not observed inspected"; coverage
complete_for_registered_sources | partial | unknown); design rationale only
from ADRs/docs/instructions/explicit human input, otherwise "No documented
design decision found"; hooks remain an evidence receiver, never an
orchestrator/runtime; invalid snapshots never served; `tadori serve .` is the
normal command; localhost default; no cloud dependency; Graphify is ignored
reference only — never import/copy/ship; never weaken golden fixtures; no
seventh tool; no runtime tracing.
