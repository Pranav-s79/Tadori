# Tadori Blueprint Index

Status values: `pending` (no blueprint) → `drafting` (being planned) →
`review` (blueprint exists, unresolved review findings) → `ready` (written +
independently reviewed) → `built` (implemented, not fully validated) →
`validated` (all gates pass) → `blocked` (explicit unresolved dependency).
Builders: S = Claude Sonnet, O = Claude Opus, H = Claude Haiku, C = Codex.
Complexity: S / M / L (one builder session each). Dependencies reference
blueprint IDs. See `BACKLOG.md` for scope detail.

| ID | Title | Phase | Status | Depends | Builder | Cx | File | Impl commit |
|---|---|---|---|---|---|---|---|---|
| 00-01 | Repo sync & README correction | 0 | validated (2026-07-17; hygiene commits on main via PR #4, README commands verified post-00-01A, statuses reconciled via PR #6) | 00-01A | S | S | `blueprints/00-01-repo-sync-and-readme.md` | `a4ab158` + PR #4/#6 |
| 00-01A | allowJs scanner contract & regression | 0 | validated (2026-07-17; full gate 178/178, `tadori diff .` exit 0 on Tadori, adversarial review PASS) | — | S | S | `blueprints/00-01A-allowjs-scanner-contract.md` | `8be4741` (main: `06d951f`, PR #5) |
| 00-02 | CI pipeline (Linux+Windows) | 0 | ready | 00-01 | H | S | `blueprints/00-02-ci-pipeline.md` | — |
| 07-01 | `packages/server` graph API | 7 | review | 00-01 | S | M | `blueprints/07-01-server-graph-api.md` | — |
| 07-02 | `packages/cli` `tadori serve .` | 7 | review | 07-01 | S | M | `blueprints/07-02-cli-tadori-serve.md` | — |
| 07-03 | Serve hardening | 7 | review | 07-02 | S | M | `blueprints/07-03-serve-hardening.md` | — |
| 08-01 | Layout engine + persistence | 8 | review | 07-01 | S | M | `blueprints/08-01-layout-engine-persistence.md` | — |
| 08-02 | `apps/viz` scaffold + package map | 8 | review | 08-01 | S | L | `blueprints/08-02-viz-package-map.md` | — |
| 08-03 | Semantic zoom: file expansion | 8 | review | 08-02 | S | M | `blueprints/08-03-semantic-zoom-files.md` | — |
| 08-04 | Task-region symbol expansion | 8 | pending | 08-03 | S | M | — | — |
| 08-05 | Search & filters | 8 | review | 08-02 | S | M | `blueprints/08-05-search-and-filters.md` | — |
| 08-06 | Inspection & evidence panels | 8 | review | 08-02 | S | M | `blueprints/08-06-inspection-evidence-panels.md` | — |
| 08-07 | Path/route/test/doc displays | 8 | review | 08-04, 08-06 | S | M | `blueprints/08-07-path-route-test-doc-displays.md` | — |
| 08-08 | `packages/hooks` event receiver | 8 | review | 07-01 | S | M | `blueprints/08-08-hooks-event-receiver.md` | — |
| 08-09 | Observation overlays | 8 | review | 08-02, 08-08 | S | M | `blueprints/08-09-observation-overlays.md` | — |
| 08-10 | Large-repo performance | 8 | review | 08-04 | S | M | `blueprints/08-10-large-repo-performance.md` | — |
| 08-11 | Browser & accessibility validation | 8 | review | 08-05, 08-06, 08-07 | S | M | `blueprints/08-11-browser-a11y-validation.md` | — |
| 08B-01 | Subsystem & overview derivation | 8B | review | 08-02 | S | M | `blueprints/08B-01-subsystem-overview-derivation.md` | — |
| 08B-02 | Tour engine + progress state | 8B | review | 08B-01 | S | M | `blueprints/08B-02-tour-engine-progress.md` | — |
| 08B-03 | Walkthrough tours | 8B | review | 08B-02 | S | M | `blueprints/08B-03-walkthrough-tours.md` | — |
| 09-01 | Review diff API + raw diff UI | 9 | review | 08-06 | S | L | `blueprints/09-01-review-diff-api-ui.md` | — |
| 09-02 | Rename/move coalescing views | 9 | review | 09-01 | S | M | `blueprints/09-02-rename-move-coalescing.md` | — |
| 09-03 | Boundary rules & violations | 9 | review | 09-01 | S | M | `blueprints/09-03-boundary-rules-violations.md` | — |
| 09-04 | `changed_with` extraction | 9 | pending | 09-01 | S | M | — | — |
| 09-05 | Agent-change review overlays | 9 | pending | 08-09, 09-01 | S | M | — | — |
| 10-01 | 2.5D fixed-tilt mode | 10 | review | 08-10 | S | M | `blueprints/10-01-25d-fixed-tilt.md` | — |
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
