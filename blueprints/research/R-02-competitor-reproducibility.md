# R-02: Competitor Reproducibility Research (Phase 11 Benchmarking)

STATUS: Research only. No installs performed, no code changed. All commands
below are UNVERIFIED — NOT RUN. This document exists to let 11-03 attempt
real installs against a documented plan, and to record failures honestly if
reproduction does not succeed.

Scope per BACKLOG.md Phase 11: benchmark Tadori against `codebase-memory-mcp`,
`codegraph`, and plain Claude Code (no third-party tool).

---

## 1. Candidate identification

### 1.1 `codebase-memory-mcp` — LOW ambiguity

Only one project uses this exact name on both npm and GitHub: GitHub
https://github.com/DeusData/codebase-memory-mcp, npm
https://www.npmjs.com/package/codebase-memory-mcp, docs
https://deusdata.github.io/codebase-memory-mcp/, associated preprint
https://arxiv.org/abs/2603.27277 ("Codebase-Memory: Tree-Sitter-Based
Knowledge Graphs for LLM Code Exploration via MCP").

A handful of unrelated projects share only the general "codebase memory"
concept, not the name — checked and excluded:
https://github.com/yuga-hashimoto/codebase-memory (architecture-decision
memory, not a code graph), https://github.com/EtienneBBeaulac/memory-mcp,
https://github.com/kapillamba4/code-memory.

**Recommendation:** target `DeusData/codebase-memory-mcp` — the only
repo/package matching the literal name in BACKLOG.md, on both GitHub and
npm under the identical name, with an associated preprint describing its
own benchmark methodology (useful for cross-checking Tadori's benchmark
claims against a documented baseline).

### 1.2 `codegraph` — HIGH ambiguity, do not guess silently

No package named plain `codegraph` exists unscoped on npm; every npm hit is
scoped (`@colbymchenry/codegraph`, `@optave/codegraph`, `@tienmanh/codegraph`,
`@zabaca/codegraph`, etc.) or a "pi-codegraph" agent-extension variant. On
GitHub, at least seven distinct, actively maintained repositories answer to
"codegraph" or "CodeGraph". Two are the closest literal matches to the bare
name in BACKLOG.md; the other five carry a distinguishing suffix
(`-mcp`, `Context`, `mcp-server-`) and are listed only for completeness:

- **colbymchenry/codegraph** — https://github.com/colbymchenry/codegraph —
  npm `@colbymchenry/codegraph`, CLI binary literally named `codegraph`,
  ~58.5k–60k stars (secondary aggregators, not GitHub API — see §7), weekly
  releases, 40 contributors, MIT.
- **codegraph-ai/CodeGraph** — https://github.com/codegraph-ai/CodeGraph —
  Rust + VS Code extension, Apache-2.0, star count not confirmed, single
  release tag seen.
- suatkocar/codegraph — https://github.com/suatkocar/codegraph — native
  Rust, 32 languages, 44 tools, star count not confirmed.
- CartographAI/mcp-server-codegraph —
  https://github.com/CartographAI/mcp-server-codegraph — different repo
  name, Python/JS/Rust only.
- websines/codegraph-mcp — https://github.com/websines/codegraph-mcp —
  different repo name.
- sdsrss/code-graph-mcp — https://github.com/sdsrss/code-graph-mcp —
  different repo name, 10 languages.
- CodeGraphContext/CodeGraphContext —
  https://github.com/CodeGraphContext/CodeGraphContext — different repo
  name, Python/Neo4j.

**I could not confirm a single canonical winner from docs alone** — several
projects independently claim the "codegraph" identity; this ambiguity is
real, not a search artifact.

**Recommendation:** target `colbymchenry/codegraph`, for three verifiable
reasons: (1) it is the only candidate whose npm scope, CLI binary name, and
MCP server registration name all reduce to the bare string `codegraph`
(§2.2); (2) it has by far the largest visible star count and release
cadence of any candidate; (3) it explicitly targets the same client surface
Tadori does (Claude Code via MCP), whereas `codegraph-ai/CodeGraph` is
Rust/VS-Code-extension first with MCP as one integration among several.

This is a judgment call, not a confirmed fact — record it as such in 11-03,
and swap the target before running anything if the benchmark author
disagrees. Do not let a future agent silently default to a different
"codegraph" repo without re-reading this section.

---

## 2. Documented install procedures (from docs/README only)

### 2.1 `codebase-memory-mcp` (DeusData)

Source: https://github.com/DeusData/codebase-memory-mcp README (fetched
2026-07-17). Documented install paths: curl\|bash installer script (with a
`--ui` variant), a Windows PowerShell installer script, an npm package
(`npm i codebase-memory-mcp` — README frames the binary installer as
primary), or manual download of a platform archive from
https://github.com/DeusData/codebase-memory-mcp/releases/latest. Exact
commands are in §5.

**Runtime requirements:** none beyond the binary itself — "single static
binary, zero dependencies," no Node/Python runtime required to execute it.
Supported OS/arch: macOS (arm64/amd64), Linux (arm64/amd64), Windows (amd64
only — no arm64 Windows build documented).

**MCP registration:** installer claims auto-detection across 43 client
surfaces (including Claude Code); manual fallback in §5.

**API keys / cloud services:** none documented. README states processing is
"100% local."

### 2.2 `codegraph` (colbymchenry) — recommended target

Source: https://github.com/colbymchenry/codegraph README (fetched
2026-07-17). Documented install paths: curl\|sh installer script, a Windows
PowerShell installer script, or `npm i -g @colbymchenry/codegraph` (any OS).
Exact commands are in §5.

**Runtime requirements:** README states the tool "bundles its own runtime,"
so Node is only required for the npm-based install path, not for the
prebuilt binary. Documented exception: **Node 22.5+ is required if embedding
codegraph as a library**, because it depends on built-in `node:sqlite`. OS
support: Windows (x64/arm64), macOS (x64/arm64), Linux (x64/arm64) — broadest
OS/arch matrix of the two candidates.

**MCP registration:** interactive installer `codegraph install` auto-wires
Claude Code, Cursor, Codex CLI, opencode, Hermes Agent, Gemini CLI, Antigravity
IDE, Kiro; manual fallback in §5.

**API keys / cloud services:** none documented; README states "100% local."

---

## 3. What each tool actually provides (per docs/README)

### 3.1 `codebase-memory-mcp`

Tree-sitter AST parsing across a claimed 158 languages (tiered: 17
"Excellent" ≥90% parse quality, 16 "Good" 75–89%, 2 "Functional" <75%), plus
"Hybrid LSP semantic type resolution" for 11–12 languages (Python,
TypeScript/JS, PHP, C#, Go, C, C++, Java, Kotlin, Rust, Perl — README says
12, only 11 named; see §7). Persists as a knowledge graph in one SQLite file
at `~/.cache/codebase-memory-mcp/`; file watcher keeps it in sync. MCP
surface: 14 named tools (`index_repository`, `list_projects`,
`delete_project`, `index_status`, `search_graph`, `trace_path`,
`detect_changes`, `query_graph`, `get_graph_schema`, `get_code_snippet`,
`get_architecture`, `search_code`, `manage_adr`, `ingest_traces`) though the
README's summary line claims "15" — mismatch unresolved, see §7. Cited:
https://github.com/DeusData/codebase-memory-mcp,
https://deusdata.github.io/codebase-memory-mcp/,
https://arxiv.org/abs/2603.27277.

### 3.2 `codegraph` (colbymchenry)

Tree-sitter AST parsing, SQLite + FTS5 full-text search, cross-file
reference resolution, auto-sync via native OS file watchers
(FSEvents/inotify/ReadDirectoryChangesW, 2-second debounce). MCP surface:
one tool by default, `codegraph_explore` ("answer almost any question in
one call" — symbol source grouped by file, call paths, blast-radius
summary). A fuller set (`node`, `search`, `callers`, `callees`, `impact`,
`files`, `status`) exists but is gated behind the `CODEGRAPH_MCP_TOOLS` env
var and is off by default — materially different from Tadori's fixed
six-tool interface and from codebase-memory-mcp's always-on surface.
Language support: 20+ named (TypeScript, JavaScript, Python, Go, Rust, Java,
C#, PHP, Ruby, C, C++, Swift, Kotlin, Dart, Svelte, Vue, Astro, Lua,
Solidity, Terraform, Nix, COBOL, and others). Cited:
https://github.com/colbymchenry/codegraph.

---

## 4. Reproducibility risk assessment

| Factor | codebase-memory-mcp | codegraph (colbymchenry) |
|---|---|---|
| Pinned version | Yes, v0.9.0 (Jul 8 2026), 36+ tags | Yes, v1.4.1 (Jul 10 2026), 29+ tags |
| API keys / external services | None documented | None documented |
| Windows support | amd64 only | x64 and arm64 |
| Linux/macOS support | arm64+amd64 both | x64+arm64 both |
| License | MIT | MIT |
| Maintenance activity | Active, release Jul 8 2026 | Active, release Jul 10 2026, weekly cadence claimed |
| Install robustness | curl\|bash / iwr\|ps1 (remote script) | curl\|sh / irm\|iex (remote script) |
| npm alternative | Yes, unscoped `codebase-memory-mcp` | Yes, scoped `@colbymchenry/codegraph` |
| Node version pin | Not needed (self-contained binary) | Not needed for CLI; 22.5+ only if embedded as library |
| Third-party research backing | Yes, arXiv preprint (2603.27277) | None found |

**Biggest shared risk:** both projects' primary documented install path is a
`curl | sh` / `irm | iex` remote script executed with implicit trust — not
independently pinnable to a content hash from the docs alone, and the script
can change server-side between benchmark runs. **Mitigation for 11-03:**
prefer the versioned npm path or a manual download of a specific tagged
release over the curl-pipe installer, so the run is pinned (see §5 recipes).

**codegraph-specific risk:** the default MCP surface exposes only one tool
(`codegraph_explore`); the fuller tool set requires setting
`CODEGRAPH_MCP_TOOLS`, which is an easy thing to silently under-run in
11-03 if not remembered — recorded here specifically so that step doesn't
get missed.

---

## 5. Candidate install recipes — UNVERIFIED, NOT RUN

Preferred recipe for each tool, for pinned reproduction in 11-03 (npm over
curl-pipe, per §4's mitigation). Nothing below has been executed.

```bash
# UNVERIFIED - NOT RUN — codebase-memory-mcp, pinned
npm i codebase-memory-mcp@0.9.0
```

```bash
# UNVERIFIED - NOT RUN — codegraph (colbymchenry), pinned
npm i -g @colbymchenry/codegraph@1.4.1
```

Vendor-documented installer-script fallback (both re-fetch latest from the
remote script at run time — not pinnable, see §4):

```bash
# UNVERIFIED - NOT RUN
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh
```

```powershell
# UNVERIFIED - NOT RUN
irm https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.ps1 | iex
irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex
```

MCP registration fallback (manual, if the installer's auto-detection misses
Claude Code):

```json
// UNVERIFIED - NOT RUN — add to ~/.claude.json
{
  "mcpServers": {
    "codebase-memory-mcp": { "command": "/path/to/codebase-memory-mcp", "args": [] },
    "codegraph": { "type": "stdio", "command": "codegraph", "args": ["serve", "--mcp"] }
  }
}
```

---

## 6. Failure documentation format (for 11-03)

A failed competitor install is a valid, recorded reproducibility result. It
must never be papered over, retried silently until it happens to work without
noting the retries, or replaced with fabricated output. Record one block per
attempt using this template:

```
### Install attempt: <tool name> <version/tag>

- Date/time:
- Operator (human or agent):
- Host OS + version:                (e.g. Windows 11 10.0.26200)
- Node version (if applicable):     (node --version)
- Shell used:                       (PowerShell / bash / etc.)
- Exact command run:                (verbatim, copy-pasted, not paraphrased)
- Exit code:
- Full stderr/stdout (or path to saved log file):
- Retry count:                      (this is retry N of M)
- Outcome: SUCCESS | FAILURE | PARTIAL
- If FAILURE: root cause if known, else "unknown — see log"
- If PARTIAL: what worked, what did not
```

Rules for 11-03:
- Every install attempt gets one of these blocks, success or failure.
- Never invent a tool's output, benchmark score, or MCP tool response for a
  competitor that failed to install. If it did not run, the benchmark result
  for that tool is "did not reproduce," not an estimate.
- If an install succeeds only after N retries, all N attempts are recorded,
  not just the last one — retry count is itself a reproducibility signal.

---

## 7. UNCONFIRMED

Facts that could not be established from docs/README alone and must not be
treated as settled:

- Which "codegraph" repository BACKLOG.md's author actually intended —
  `colbymchenry/codegraph` is this document's recommendation, not a
  confirmed fact (§1.2).
- codebase-memory-mcp's exact tool count ("15" claimed, 14 named) and
  "Hybrid LSP" language count ("12" claimed, 11 named) — both discrepancies
  present verbatim in the fetched README, not resolved.
- Star/contributor/release-cadence figures for `colbymchenry/codegraph`
  come from secondary aggregators (star-history.com, ossinsight.io,
  repositoryradar.dev), not the GitHub API directly — approximate only.
- Star/activity counts for the other six "codegraph" candidates in §1.2
  were not confirmed at all — listed for completeness, not verified.
- Whether codebase-memory-mcp's npm package and binary installer ship
  identical functionality is not stated explicitly in the docs fetched.
- Neither tool's docs were checked against actual `package.json` /
  `Cargo.toml` / release checksums — version numbers are as displayed on
  GitHub releases pages at fetch time (2026-07-17) and may drift before
  11-03 runs.
- No pricing/Pro-tier gating was investigated beyond an incidental "27
  Pro-only security tools" mention for the non-recommended
  `codegraph-ai/CodeGraph` — irrelevant to the recommended target, noted
  only so it isn't confused with it later.

---

## Fact-Forcing Gate (if triggered)

- Importers: none — this is a new markdown research document with no code
  importers.
- Affected API: none — no source files, schemas, or fixtures touched.
- Data files: none — no data files created, read, or modified.
- User instruction: produce R-02 competitor reproducibility research for
  Tadori Phase 11 (benchmark research planner role, WebSearch/WebFetch only,
  no installs, no code changes).
