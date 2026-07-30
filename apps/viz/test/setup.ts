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

// Sigma's public rendering-program entrypoint reads WebGL enum constants when
// modules load. jsdom has no WebGL globals; these constants let renderer unit
// tests import custom program classes while the Sigma constructor itself stays
// mocked (no drawing context is fabricated).
class TestWebGLRenderingContext {
  static readonly POINTS = 0x0000;
  static readonly LINES = 0x0001;
  static readonly TRIANGLES = 0x0004;
  static readonly BYTE = 0x1400;
  static readonly UNSIGNED_BYTE = 0x1401;
  static readonly SHORT = 0x1402;
  static readonly UNSIGNED_SHORT = 0x1403;
  static readonly INT = 0x1404;
  static readonly UNSIGNED_INT = 0x1405;
  static readonly FLOAT = 0x1406;
  static readonly BOOL = 0x8b56;
}

if (globalThis.WebGLRenderingContext === undefined) {
  Object.defineProperty(globalThis, "WebGLRenderingContext", {
    configurable: true,
    value: TestWebGLRenderingContext
  });
}
if (globalThis.WebGL2RenderingContext === undefined) {
  Object.defineProperty(globalThis, "WebGL2RenderingContext", {
    configurable: true,
    value: TestWebGLRenderingContext
  });
}
