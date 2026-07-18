import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ServeConfig {
  root: string;
  hasGitignore: boolean;
  hasTadoriignore: boolean;
  rules: unknown | null;
}

/**
 * Loads project configuration (CLI_CONTRACT.md step 2): records whether
 * `.gitignore`/`.tadoriignore` exist (informational only — actual ignore
 * application already happens inside `scanRepository`) and parses
 * `tadori.rules.json` if present. Does not act on rule contents (09-03's
 * scope).
 */
export function loadServeConfig(root: string): ServeConfig {
  const rulesPath = path.join(root, "tadori.rules.json");
  let rules: unknown | null = null;
  if (existsSync(rulesPath)) {
    const raw = readFileSync(rulesPath, "utf8");
    try {
      rules = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Failed to parse tadori.rules.json: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return {
    root,
    hasGitignore: existsSync(path.join(root, ".gitignore")),
    hasTadoriignore: existsSync(path.join(root, ".tadoriignore")),
    rules
  };
}
