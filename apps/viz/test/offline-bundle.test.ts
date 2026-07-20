import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// §13 offline-bundle / CSP-style assertion, run against the REAL `vite build`
// output (`dist/`), not the mock. Guarantees the served bundle never reaches
// an external host at runtime: no absolute `<script src>`/`<link href>` in
// index.html, and no `http(s)://<host>` literal in any dist file whose host is
// anything other than the local loopback.
//
// Two library-internal literals are provably NOT fetch targets and are the
// only allowed exceptions:
//   - www.w3.org  — the SVG/XML namespace URI baked into React/graphology.
//   - react.dev   — the docs link in React's minified error messages.
// Anything else (a CDN, a font host, an analytics beacon) is a real regression.
const HOST_ALLOWLIST = new Set([
  "127.0.0.1",
  "localhost",
  "www.w3.org",
  "react.dev"
]);

// vitest runs with cwd at the package root (apps/viz); dist/ is a sibling of test/.
const distDir = join(process.cwd(), "dist");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// This suite asserts against the real `vite build` output. When `dist/` is
// absent (a bare `test` run without a preceding build) it skips rather than
// fails — the offline invariant only has meaning once a bundle exists, and the
// completion proof runs `vite build` before `test`.
const built = existsSync(join(distDir, "index.html"));

describe.skipIf(!built)("offline bundle", () => {
  it("index.html has no absolute external script/link references", () => {
    const html = readFileSync(join(distDir, "index.html"), "utf8");
    const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(
      (m) => m[1]
    );
    const external = refs.filter((ref) => /^(?:https?:)?\/\//i.test(ref));
    expect(external, `external asset refs in index.html: ${external.join(", ")}`)
      .toEqual([]);
  });

  it("no dist file references an external host", () => {
    const offenders: string[] = [];
    for (const file of walk(distDir)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = m[1].toLowerCase();
        if (!HOST_ALLOWLIST.has(host)) {
          offenders.push(`${file}: ${m[0]}`);
        }
      }
    }
    expect(offenders, `external-host literals:\n${offenders.join("\n")}`).toEqual(
      []
    );
  });
});
