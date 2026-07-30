# Tadori CLI

Tadori maps mixed-language repositories into one provenance-typed local graph
and serves its accessible 2D Atlas entirely on the user's workstation.

```bash
tadori diff <repository>
tadori serve <repository>
tadori purge <repository>
```

`serve` binds only to `127.0.0.1`, stores its SQLite index under the selected
repository's `.tadori/` directory, and performs no external runtime fetch.
`purge` removes only that confined local index after a real-path safety check.

See the [project README](https://github.com/Pranav-s79/Tadori#readme) and
[deployment runbook](https://github.com/Pranav-s79/Tadori/blob/main/docs/DEPLOYMENT.md)
for supported Node versions, release validation, and operational security.
