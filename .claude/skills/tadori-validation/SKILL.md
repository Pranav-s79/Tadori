---
name: tadori-validation
description: Use after Tadori repository changes to run required validation and report executed evidence. Do not use as a substitute for implementation work.
---

# Tadori validation

After applicable repository changes, run and report evidence for:

```powershell
pnpm skills:check
pnpm typecheck
pnpm lint
pnpm test
python validate_fixtures.py
pnpm fixtures:validate
pnpm fixtures:index
pnpm fixtures:typecheck
```

For graph storage or indexing changes, additionally verify `PRAGMA
foreign_key_check`, dangling-endpoint membership validation, deterministic
repeated indexing, and exact fixture comparison. Inspect both staged and
unstaged Git diffs, confirm frozen specifications, fixtures, and schemas remain
unchanged, and update `IMPLEMENTATION_STATUS.md`.

Do not claim success without executed validation evidence. If a check cannot be
run, state the exact command, result, reason, and next action; do not infer a
pass.
