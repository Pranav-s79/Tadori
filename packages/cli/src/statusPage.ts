export interface StartupFactsLike {
  repoRoot: string;
  snapshotId: number;
  indexState: "fresh" | "refreshed" | "rebuilt" | "stale";
  mode: "2d";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Minimal truthful status page (blueprint 07-02 §10) served at `GET /` in
 * place of the not-yet-built viz UI (08-02 replaces this wholesale). Plain
 * semantic HTML, no framework, explicitly not styled as a dashboard.
 */
export function renderStatusPage(facts: StartupFactsLike): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tadori server status</title>
</head>
<body>
<h1>Tadori server status</h1>
<dl>
<dt>Repository root</dt><dd>${escapeHtml(facts.repoRoot)}</dd>
<dt>Snapshot</dt><dd>#${facts.snapshotId} (${escapeHtml(facts.indexState)})</dd>
<dt>Mode</dt><dd>${escapeHtml(facts.mode)}</dd>
</dl>
<p><a href="/api/v1/snapshot">/api/v1/snapshot</a></p>
<p>The Tadori visualization UI is not yet built (arrives in Phase 8, blueprint 08-02). This page reports server status only.</p>
</body>
</html>
`;
}
