# Tadori deployment and release runbook

Tadori deploys as a local workstation CLI with an embedded visualization. The
supported production boundary is the installed `tadori` package serving a
user-selected repository on `127.0.0.1`; the core product is not a hosted
multi-tenant web service and does not upload repository contents.

The active product contract is
`docs/Specs/Tadori-Multilanguage-Transition.md`.

## Runtime requirements

- Node.js 22 or newer. On Windows, use Node 22 while the documented upstream
  recursive-watcher regression remains present.
- No database service, cloud account, API key, or runtime asset download.
- Write access to `<repository>/.tadori/` for the local SQLite index.
- Loopback access to an operating-system-assigned port, or to the explicitly
  requested `--port`.

## Build the distributable artifact

From a clean repository checkout:

```bash
pnpm install --frozen-lockfile
pnpm skills:check
pnpm typecheck
pnpm lint
pnpm test
python validate_fixtures.py
pnpm fixtures:validate
pnpm fixtures:index
pnpm fixtures:typecheck
pnpm audit --prod
pnpm package:artifact
npm pack --dry-run --json ./dist/package
pnpm package:smoke
```

`pnpm package:artifact` builds the offline visualization and materializes the
installable package under `dist/package`. `npm pack --dry-run` is the release
manifest audit: review the emitted file list before creating a tarball.
`pnpm package:smoke` then packs and installs that exact artifact in a temporary
prefix and verifies the installed `diff`, `serve`, and `purge` commands,
embedded visualization/API, mixed-language structural provenance, and local
data confinement without publishing anything.

Create and test the exact tarball that would be distributed:

```bash
cd dist/package
npm pack
cd ../..
npm install --prefix <temporary-install-directory> ./dist/package/tadori-0.1.0.tgz
```

Do not publish from the workspace root. It is private by design; only the
generated package is distributable.

## Production smoke test

Use a disposable repository copy so the smoke test cannot modify a working
tree under development:

```bash
<temporary-install-directory>/node_modules/.bin/tadori serve <repository-copy> --no-open
```

Acceptance evidence:

1. Startup reports the resolved repository, snapshot, `Mode: 2d`, and a
   `http://127.0.0.1:<port>/` URL.
2. `GET /` returns the built visualization with no external runtime request.
3. `GET /api/v1/snapshot` returns the served snapshot context.
4. `GET /api/v1/nodes?level=package` and `GET /api/v1/layout?level=package`
   return capped, internally consistent data.
5. Python or another bundled structural language reports its language,
   structural capability, parser derivation, and extractor provenance.
6. Ctrl+C exits cleanly and releases the port.
7. `tadori purge <repository-copy>` removes only
   `<repository-copy>/.tadori/` and leaves source files untouched.

## Operational security

- Keep the listener on `127.0.0.1`. Tadori intentionally has no public bind
  flag, authentication layer, or hosted-repository trust boundary.
- Treat source, evidence snippets, graph rows, diffs, and local paths as
  repository-sensitive information even though they remain on the machine.
- Configure `.tadoriignore` for repository-specific exclusions before the
  first index. Boundary rules, when used, live in `tadori.rules.json`.
- Use `tadori purge <repository>` when the local index should no longer be
  retained.

## Release authorization still required

The generated package currently declares `UNLICENSED`. A public npm
publication or public binary release requires an explicit owner decision on
the license, registry/repository destination, package visibility, and release
version. Do not infer those values or publish publicly without that authority.

Private tarball distribution and local installation are supported now and do
not require a registry secret.
