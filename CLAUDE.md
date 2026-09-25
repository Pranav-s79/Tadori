# Tadori

Local codebase-study tool: an indexer builds a snapshot graph of a repository,
and `tadori serve` shows it in a local web app (`apps/viz`) plus an MCP server.

- `IMPLEMENTATION_STATUS.md` is the one-page current state and next steps.
- Work in small PRs off `main`; never push to `main` directly. Pushing branches,
  opening PRs and squash-merging green PRs is fine.
- Check changes with `pnpm typecheck`, `pnpm --filter @tadori/viz typecheck`,
  `pnpm lint` and `pnpm test` (CI runs exactly these).
- Use `pnpm`, not `npx`: the SQLite suites need the pinned Node from `.npmrc`.
- Show facts honestly in the UI: inferred stays labelled inferred, unresolved
  stays unresolved, and static analysis never reads as runtime behaviour.
