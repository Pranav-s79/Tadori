# Tadori builder handoff guide

How a fresh builder session (Claude Sonnet, Claude Opus, Codex, or Claude
Haiku — cold start, no hidden context) implements exactly one blueprint.

## 1. Read your blueprint — and only yours

Open `blueprints/<ID>-<slug>.md`. Read it completely before touching
anything. Your blueprint is the contract; `blueprints/ARCHITECTURE.md`
defines shared cross-phase contracts your blueprint references;
`blueprints/ASSUMPTIONS.md` and `blueprints/RISKS.md` carry global
constraints. Do not read other blueprints except those named in your
"Depends on" line.

## 2. Inspect required files

Read every file in your blueprint's §4 "files to read first" list. Verify
the §4 evidence still matches reality (line numbers may drift; semantics
must not). If the code contradicts the blueprint's evidence, STOP and
report the mismatch — do not improvise around it.

## 3. Confirm prerequisites

- `git status --short` must be clean before you start.
- Verify every "Depends on" blueprint shows `built` or `validated` in
  `blueprints/INDEX.md`, and that the exact contracts it promised exist in
  the code (import them; do not re-declare them).
- Verify branch: work lands on the branch named by the Program Manager's
  wave plan (see `blueprints/PARALLEL_WORK_MATRIX.md`); never on `main`.
  `main` advances only via owner-merged PRs (ASSUMPTIONS A-001).

## 4. Implement only your scope

Follow §11 (ordered implementation procedure) step by step. §5 is your
scope; §6 is explicitly not. Touch only files listed in §9. If you believe
another file must change, that is a scope finding: record it, implement
nothing outside §9, and report it in your final report.

Environment rules (non-negotiable):

- Run everything through pnpm (`.npmrc` pins Node 22.14.0; global Node 25
  cannot build better-sqlite3).
- Write files with LF endings (`.gitattributes` enforces `* text=auto
  eol=lf`; fixture hashes depend on it).
- A "Fact-Forcing Gate" hook may deny your first write to each file: state
  the four requested facts in plain text (importers, affected API, data
  schemas, verbatim instruction) and retry the identical write.
- Never weaken a golden fixture, schema, or frozen migration to make
  anything pass. A fixture delta is a stop-and-report event.

## 5. Run incremental tests

Every §11 step that adds a test runs it immediately. Keep the full suite
green as you go — do not batch test debt to the end.

## 6. Run final validation

Execute your blueprint's §15 validation commands completely. All existing
repository gates must pass (typecheck, lint, full test suite, all fixture
gates, git diff --check). Record exact counts and PASS lines. If a gate
fails: fix your work or report blocked — never delete or weaken the gate.

## 7. Commit

- One logical commit per blueprint unless §11 states otherwise.
- Imitate existing message style (`feat(indexer): …`, `fix(indexer): …`,
  `docs(planning): …`, `ci: …`).
- Update `IMPLEMENTATION_STATUS.md` (dated subsection, per project rules),
  `blueprints/INDEX.md` (status + impl commit SHA), and `BACKLOG.md` in the
  same commit or an immediately following docs commit.
- Never push, tag, or create releases unless your blueprint explicitly
  carries a recorded owner authorization for that exact ref set.

## 8. Return the required report

Your blueprint's §21 lists the required fields. Always include: summary;
files changed; contracts implemented; tests added (names + counts);
validation output summary; benchmark evidence where applicable; commit SHA;
known limitations; follow-on risks; every `ASSUMPTION:` line you made.
Statuses you may set: `built` (implemented, gates green) — `validated` only
when every §14 acceptance criterion has been executed and observed.

## 9. Do not modify future-phase work

Do not scaffold, stub, or "prepare" files owned by later blueprints. Do not
edit other blueprints' sections of INDEX.md. If your work reveals a defect
in a later blueprint's plan, write it as a finding in your report; the
Program Manager updates the vault.

## Failure protocol

Blocked (missing prerequisite, contradicting evidence, failing gate you did
not cause, frozen-contract conflict): stop that item, leave the tree clean
(commit nothing half-done), set INDEX status `blocked` with a one-line
reason, and report. A wrong-but-committed change is worse than a reported
blocker.
