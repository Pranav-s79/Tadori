import { describe, expect, it } from "vitest";
import { buildDeepLink, isRootConfined } from "./deepLink.ts";

describe("isRootConfined", () => {
  it("accepts an ordinary repo-relative path", () => {
    expect(isRootConfined("packages/server/src/routes/source.ts")).toBe(true);
  });

  it("tolerates a leading ./ and redundant separators", () => {
    expect(isRootConfined("./src/index.ts")).toBe(true);
    expect(isRootConfined("src//nested/file.ts")).toBe(true);
  });

  it("rejects an empty path", () => {
    expect(isRootConfined("")).toBe(false);
  });

  it("rejects a path with a .. segment", () => {
    expect(isRootConfined("../etc/passwd")).toBe(false);
    expect(isRootConfined("src/../../secret")).toBe(false);
    expect(isRootConfined("a/b/../../../c")).toBe(false);
  });

  it("rejects absolute POSIX, Windows-drive, and UNC paths", () => {
    expect(isRootConfined("/etc/passwd")).toBe(false);
    expect(isRootConfined("C:\\Windows\\System32")).toBe(false);
    expect(isRootConfined("\\\\server\\share")).toBe(false);
  });
});

describe("buildDeepLink", () => {
  it("builds a valid encoded URL for a confined path", () => {
    expect(buildDeepLink("/home/user/repo", "src/index.ts")).toBe(
      "vscode://file//home/user/repo/src/index.ts"
    );
  });

  it("appends the line suffix when a positive line is given", () => {
    expect(buildDeepLink("/repo", "src/a.ts", 42)).toBe("vscode://file//repo/src/a.ts:42");
  });

  it("omits the suffix for null / zero / negative line", () => {
    expect(buildDeepLink("/repo", "a.ts", null)).toBe("vscode://file//repo/a.ts");
    expect(buildDeepLink("/repo", "a.ts", 0)).toBe("vscode://file//repo/a.ts");
  });

  it("percent-encodes spaces and special characters per segment", () => {
    expect(buildDeepLink("/repo root", "my dir/a file.ts")).toBe(
      "vscode://file//repo%20root/my%20dir/a%20file.ts"
    );
    // A '#' in a filename must not be read as a URL fragment.
    expect(buildDeepLink("/repo", "weird#name.ts")).toBe("vscode://file//repo/weird%23name.ts");
  });

  it("joins a Windows absolute root with a forward-slash repo file, preserving the drive", () => {
    expect(buildDeepLink("C:\\Users\\dev\\repo", "src/app.ts", 7)).toBe(
      "vscode://file/C:/Users/dev/repo/src/app.ts:7"
    );
  });

  it("returns null for a non-confined file (renders no link)", () => {
    expect(buildDeepLink("/repo", "../../etc/passwd")).toBeNull();
    expect(buildDeepLink("/repo", "/absolute/leak")).toBeNull();
  });
});
