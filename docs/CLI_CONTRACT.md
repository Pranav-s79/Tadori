# Tadori CLI compatibility contract

This document records the implemented compatibility contract for Tadori's
normal local visualization command. Language scope and graph semantics are
governed by `docs/Specs/Tadori-Multilanguage-Transition.md`.

## The normal command

```bash
tadori serve .
```

During workspace development (before the CLI is packaged), the equivalent
workspace script fulfills the same contract.

## Required behavior

`tadori serve <path>` must, in order:

1. **Resolve the repository** — normalize `<path>` to a repository root;
   fail with an actionable message if the path is not a supported repository.
2. **Load configuration** — project configuration, `.gitignore` /
   `.tadoriignore` exclusions, and any `tadori.rules.json`.
3. **Reuse or refresh a valid graph snapshot** — reuse the newest valid
   snapshot when fresh; incrementally refresh when stale; fall back to a full
   index when incremental correctness cannot be proven.
4. **Validate the snapshot** — integrity checks (dangling-endpoint membership,
   foreign-key check) must pass before the snapshot is served. An invalid
   snapshot is never served; the last valid snapshot remains served instead.
5. **Start the local API** — bound to `127.0.0.1` only.
6. **Start the visualization** — the stable 2D interface is the default.
7. **Open the browser** — unless `--no-open` is passed; a browser-launch
   failure is reported with the URL and is not fatal.
8. **Print startup facts** — repository root, snapshot id, index state
   (fresh / refreshed / rebuilt / stale), mode, and URL.
9. **Stop all child processes on Ctrl+C** — API, watcher, and frontend all
   terminate; no orphan processes.

## Flags

```text
--port <number>       Port for the local server (default: an open port).
--no-open             Do not launch a browser.
--reindex             Force a full reindex before serving.
--mode 2d             Stable default 2D interface.
--mode 2.5d           Reserved; currently exits with an actionable unsupported-mode error.
--mode 3d-experiment  Reserved; currently exits with an actionable unsupported-mode error.
--snapshot <id>       Serve a specific stored snapshot.
```

Default and currently implemented mode: `2d`. Reserved depth modes must not be
presented as available until they render the same canonical entities and
relations from named queryable fields, never decoration.

## Non-negotiables

- Localhost-only binding by default; no hidden cloud dependency.
- Invalid snapshots are never served.
- Evidence, origin, confidence, and resolution stay visible in every mode.
- The six-tool MCP interface is separate from this command; `tadori serve`
  must not add MCP tools.
