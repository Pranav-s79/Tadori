import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@tadori/core": r("./packages/core/src/index.ts"),
      "@tadori/store": r("./packages/store/src/index.ts"),
      "@tadori/indexer": r("./packages/indexer/src/index.ts"),
      "@tadori/harness": r("./packages/harness/src/index.ts"),
      "@tadori/mcp": r("./packages/mcp/src/index.ts"),
      "@tadori/server": r("./packages/server/src/index.ts"),
      "@tadori/cli": r("./packages/cli/src/index.ts")
    }
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
});
