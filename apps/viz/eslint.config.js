import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Standalone flat config for apps/viz. Does NOT extend the root
// eslint.config.js (root now ignores apps/**) so this app can evolve
// independently while keeping its own strict rules, notably the
// no-restricted-imports boundary that keeps the frontend talking to the
// backend ONLY over HTTP/WebSocket (never importing @tadori/* packages or
// Node-only builtins that would break the browser bundle).
export default tseslint.config(
  {
    ignores: ["node_modules/**", "dist/**", "coverage/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "no-console": "off",
      eqeqeq: ["error", "always"],
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
