import { expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

// NOT `import "@testing-library/jest-dom/vitest"`: that entry point does
// `import { expect } from "vitest"` from *jest-dom's own package
// location*, which pnpm's flattened node_modules resolves to a different,
// older vitest instance hoisted from another workspace package (vitest
// 2.1.9) than the one actually running this test process (vitest 4.1.10,
// resolved correctly from apps/viz's own dependency tree). Two `expect`
// singletons means `expect.extend` patches the wrong one, so matchers
// silently never appear ("Invalid Chai property: toBeInTheDocument").
// Importing the plain matchers object (no internal vitest import) and
// extending our own `expect` here — resolved correctly, verified via
// require.resolve from this file's location — avoids the collision.
expect.extend(matchers);
