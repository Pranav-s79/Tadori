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
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "no-console": "off",
      eqeqeq: ["error", "always"]
    }
  }
);
