# Tadori Codex configuration

This is Tadori's project-local Codex configuration. Codex project skills live
in `.agents/skills`; their canonical sources live in `agent-skills`. Generated
copies must not be edited directly. After changing a canonical skill, run:

```powershell
pnpm skills:sync
pnpm skills:check
```

Global user skills are not vendored into Tadori, and Tadori must remain usable
when those global skills are absent. Project-local Tadori rules override
conflicting general-purpose skill guidance (see `AGENTS.md`).

| Skill | Current use |
| --- | --- |
| `tadori-spec-guardian` | Architecture and scope protection |
| `tadori-validation` | Validation after repository changes |
| `tadori-indexer` | TypeScript graph extraction work |
| `tadori-visual-workflow` | Future CLI and visualization phases |
