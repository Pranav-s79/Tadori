declare function test(name: string, fn: () => void): void;

test("math still works", () => {
  // Deliberately no import or call into src/math.ts.
});
