import { factorial, format } from "../src/math.js";

declare function test(name: string, fn: () => void): void;

test("factorial computes recursively", () => {
  factorial(4);
});

test("format accepts numbers", () => {
  format(4);
});
