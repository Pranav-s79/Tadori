import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "packages/fixtures/**",
      "packages/bench/fixtures/**",
      "docs/**",
      "front_end_template/**",
      "**/dist/**",
      "**/coverage/**",
      ".tmp/**",
      ".claude/worktrees/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `.tsx` is included deliberately: when this block matched only `**/*.ts`,
    // React sources silently fell back to the recommended defaults and lost the
    // `^_` ignore pattern, so the effective rules depended on a file extension.
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "no-console": "off",
      eqeqeq: ["error", "always"]
    }
  },
  {
    // apps/viz is a browser bundle: it must reach the backend only over
    // HTTP/WebSocket, never by importing @tadori/* packages or Node builtins
    // that would break the bundle. This boundary previously lived in a
    // standalone apps/viz/eslint.config.js that no gate ever ran, so CI did
    // not enforce it.
    files: ["apps/viz/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tadori/*"],
              message:
                "apps/viz must not import @tadori/* packages directly; talk to the backend only via fetch/WebSocket against /api/v1/*."
            }
          ],
          paths: [
            {
              name: "fs",
              message: "apps/viz is a browser bundle and must not import Node's fs module."
            },
            {
              name: "node:fs",
              message: "apps/viz is a browser bundle and must not import Node's fs module."
            },
            {
              name: "better-sqlite3",
              message: "apps/viz is a browser bundle and must not import better-sqlite3."
            }
          ]
        }
      ]
    }
  }
);
