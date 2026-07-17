# Tadori Blueprint Index

Status values: `pending` (no blueprint yet) → `ready` (blueprint written +
reviewed) → `built` → `validated`. Builders: S = Claude Sonnet, H = Claude
Haiku, C = Codex. Complexity: S / M / L (one builder session each).
Dependencies reference blueprint IDs. See `BACKLOG.md` for scope detail.

| ID | Title | Phase | Status | Depends | Builder | Cx | File | Impl commit |
|---|---|---|---|---|---|---|---|---|
| 00-01 | Repo sync & README correction | 0 | ready (re-scoped 2026-07-17: option a, no main push) | — | S | S | `blueprints/00-01-repo-sync-and-readme.md` | — |
| 00-02 | CI pipeline (Linux+Windows) | 0 | pending | 00-01 | H | S | — | — |
| 07-01 | `packages/server` graph API | 7 | pending | 00-01 | S | M | — | — |
| 07-02 | `packages/cli` `tadori serve .` | 7 | pending | 07-01 | S | M | — | — |
| 07-03 | Serve hardening | 7 | pending | 07-02 | S | M | — | — |
| 08-01 | Layout engine + persistence | 8 | pending | 07-01 | S | M | — | — |
| 08-02 | `apps/viz` scaffold + package map | 8 | pending | 08-01 | S | L | — | — |
| 08-03 | Semantic zoom: file expansion | 8 | pending | 08-02 | S | M | — | — |
| 08-04 | Task-region symbol expansion | 8 | pending | 08-03 | S | M | — | — |
| 08-05 | Search & filters | 8 | pending | 08-02 | S | M | — | — |
| 08-06 | Inspection & evidence panels | 8 | pending | 08-02 | S | M | — | — |
| 08-07 | Path/route/test/doc displays | 8 | pending | 08-04, 08-06 | S | M | — | — |
| 08-08 | `packages/hooks` event receiver | 8 | pending | 07-01 | S | M | — | — |
| 08-09 | Observation overlays | 8 | pending | 08-02, 08-08 | S | M | — | — |
| 08-10 | Large-repo performance | 8 | pending | 08-04 | S | M | — | — |
| 08-11 | Browser & accessibility validation | 8 | pending | 08-05, 08-06, 08-07 | S | M | — | — |
| 08B-01 | Subsystem & overview derivation | 8B | pending | 08-02 | S | M | — | — |
| 08B-02 | Tour engine + progress state | 8B | pending | 08B-01 | S | M | — | — |
| 08B-03 | Walkthrough tours | 8B | pending | 08B-02 | S | M | — | — |
| 09-01 | Review diff API + raw diff UI | 9 | pending | 08-06 | S | L | — | — |
| 09-02 | Rename/move coalescing views | 9 | pending | 09-01 | S | M | — | — |
| 09-03 | Boundary rules & violations | 9 | pending | 09-01 | S | M | — | — |
| 09-04 | `changed_with` extraction | 9 | pending | 09-01 | S | M | — | — |
| 09-05 | Agent-change review overlays | 9 | pending | 08-09, 09-01 | S | M | — | — |
| 10-01 | 2.5D fixed-tilt mode | 10 | pending | 08-10 | S | M | — | — |
| 10-02 | 3D experimental flag | 10 | pending | 10-01 | S | M | — | — |
| 10-03 | Depth study instrumentation | 10 | pending | 10-01, 10-02 | S | S | — | — |
| 11-01 | `packages/bench` harness | 11 | pending | 00-02 | S | L | — | — |
| 11-02 | Seeded-trap repos + task sets | 11 | pending | 11-01 | S | L | — | — |
| 11-03 | Competitor profiles + protocol | 11 | pending | 11-02 | S | M | — | — |
| 12-01 | Privacy & data lifecycle | 12 | pending | 07-02 | S | M | — | — |
| 12-02 | Failure hardening | 12 | pending | 07-03 | S | L | — | — |
| 12-03 | Packaging & cross-platform | 12 | pending | 07-03, 00-02 | S | M | — | — |
| 12-04 | Documentation & demo | 12 | pending | 08-11, 09-02 | S | M | — | — |
| 12-05 | Pilot package & RC | 12 | pending | 12-01..12-04 | S | M | — | — |

Research inputs (no product code): `blueprints/research/` — R-01 Graphify UX
observations; R-02 competitor install reproducibility (feeds 11-03).
