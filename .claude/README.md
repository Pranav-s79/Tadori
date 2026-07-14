# Tadori Claude Code configuration

This is Tadori's project-local Claude Code configuration. Claude project skills
live in `.claude/skills`; their canonical sources live in `agent-skills`.
Generated copies must not be edited directly. After changing a canonical skill,
run:

```powershell
pnpm skills:sync
pnpm skills:check
```

Global user skills remain under `%USERPROFILE%\.claude\skills`. They are not
vendored into Tadori, and Tadori must remain usable when those global skills are
absent.

| Skill | Current use |
| --- | --- |
| `tadori-spec-guardian` | Architecture and scope protection |
| `tadori-validation` | Validation after repository changes |
| `tadori-indexer` | TypeScript graph extraction work |
| `tadori-visual-workflow` | Future CLI and visualization phases |
