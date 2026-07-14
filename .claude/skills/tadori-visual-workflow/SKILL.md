---
name: tadori-visual-workflow
description: Use for future Tadori CLI serving and visualization workflow decisions. Its presence does not authorize premature visual implementation.
---

# Tadori visual workflow

The future normal command is:

```bash
tadori serve .
```

During monorepo development use:

```bash
pnpm tadori serve .
```

Preserve stable 2D as the default, optional 2.5D, and experimental 3D only
behind an explicit mode. Bind locally to `127.0.0.1`, open the browser
automatically unless `--no-open` is supplied, and shut down cleanly with
`Ctrl+C`. Support package/file/symbol multi-resolution loading.

Visual fields must be graph-driven, partial retrieval coverage must be honest,
and there must be no city metaphor or decorative data-free visualization. Do
not use `scroll-world` in the core application; it may be considered later only
for a separate marketing or cinematic demonstration page. This skill does not
authorize premature visual implementation.
