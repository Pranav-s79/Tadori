import { getSession } from "../lib/session-service.js";

declare function test(name: string, fn: () => void): void;

test("getSession reads the repository", () => {
  getSession("test");
});
