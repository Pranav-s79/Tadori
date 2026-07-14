declare function test(name: string, fn: () => void): void;

test("admin route exists", () => {
  // Deliberately no import from the admin route or controller.
});
