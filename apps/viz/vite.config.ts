import react from "@vitejs/plugin-react";
// From "vitest/config", not "vite": this re-exports vite's own
// defineConfig but merges in the `test` block's type augmentation, so a
// plain `tsc --noEmit` (not just Vite itself, which resolves it fine at
// runtime either way) recognizes the `test` option below.
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Fully offline bundle: inline everything rather than emitting
    // separate asset files that could be requested externally.
    assetsInlineLimit: 100_000_000
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"]
  }
});
