# Deep-link selection restoration

**Date:** 2026-07-31
**Status:** approved

## Problem

A URL carrying `?mode=interview&select=<entity-key>` does not restore the entity.
Reaching the same state by clicking through Overview works. A shared link
therefore silently degrades to a generic repository interview, with no signal
that anything was dropped.

## Root cause

`App.tsx` gates the restore on the rendered graph:

```ts
if (!data.representativeByEntityKey.has(linked)) return;
```

`representativeByEntityKey` contains only entities reachable in the current
level-of-detail projection. The landing view is bounded to a single repository
node, so any deeper entity — every route, symbol and file — fails the guard.
The `return` is silent: no state records that a key was supplied and rejected.

This is the fourth instance of one defect class in this app: deriving entity
facts from the *rendered* graph instead of the snapshot. The three already
fixed are Overview entry points, inspector continuations, and interview
subject/tests.

## Selection ownership

One owner, one read, one write:

- **Owner:** `useInspectionStore` holds the current entity.
- **Read:** `readUrlState` parses `select` once into `initialUrlState`
  (`urlState.ts:68`); consumed by the restore effect at `App.tsx:191-196`.
- **Write:** the URL writer publishes `selectedEntityKey: inspectedEntityKey`
  (`App.tsx:213`), so any selection change is reflected back into the address bar.

No other component resolves `select`.

## Design

**Drop the level-of-detail guard; let the entity endpoint decide.**

1. `App.tsx` opens the linked key directly. The rendered graph no longer has a
   vote in whether a link resolves.
2. `InterviewPanel` already calls `fetchNodeDetail`. Its subject becomes an
   explicit state rather than `NodeDetail | null`:

   | state | meaning | rendering |
   |---|---|---|
   | `none` | no key supplied | whole-repository interview (legitimate) |
   | `loading` | key supplied, resolving | "Resolving the selected entity…" |
   | `ok` | key resolved | entity-specific interview |
   | `unavailable` | `not_found` / `ambiguous` / error | explicit sentence, basis `unknown` |

   The distinction that matters: **"no entity selected" and "the selected entity
   could not be found" must never render identically.** Collapsing them is what
   makes a stale link look like a working one.
3. `NodeView` already renders `not_found` and `ambiguous` honestly for the
   Inspector; unchanged.

### Rejected alternatives

- **Eagerly load the whole graph so the guard passes.** Defeats the LOD budgets
  the server enforces, and scales with repository size for no gain.
- **Validate in `App` before opening.** Stricter, but fetches each key twice —
  once to validate, once when `NodeView` renders it.
- **Shared `useEntityResolution` hook.** Cleanest long-term, but introduces an
  abstraction and modifies the Inspector, which works and is out of scope here.

## Acceptance criteria

- A valid `select` key on direct landing restores the entity.
- The interview heading names it.
- Its dependencies, tests and evidence load.
- Refresh preserves the selection.
- Switching modes does not clear a valid selection.
- An invalid or stale key renders an explicit unavailable state, never a silent
  fallback to the repository interview.
- Resolution does not depend on the initially rendered `data.nodes` subset.

## Testing

Focused tests: direct URL landing with a valid key; refresh restoration;
invalid key producing the unavailable state; mode switching preserving
selection. Then full serial suite, one parallel run reported honestly, strict
typecheck, production build, and live verification by pasting the URL into a
browser against a real fixture.

## Out of scope

KF-001, the MCP provenance contract, and the parallel-suite flakiness (tracked
separately in `IMPLEMENTATION_STATUS.md`).
