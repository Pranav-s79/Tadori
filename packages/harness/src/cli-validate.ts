import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateFixtures } from "./validateFixtures.js";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const errors = validateFixtures(repoRoot);

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Tadori golden fixtures: all schema, identity, endpoint, and evidence checks passed."
);
