import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectServices, IncrementalProjectServices } from "@tadori/indexer";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("persistent TypeScript project services", () => {
  it("keeps one LanguageService while refreshing changed, added, and removed roots", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tadori-project-refresh-"));
    roots.push(root);
    const src = path.join(root, "src");
    mkdirSync(src);
    const a = path.join(src, "a.ts");
    const b = path.join(src, "b.ts");
    writeFileSync(a, "export const value = 1;\n");
    const project = new IncrementalProjectServices(root, [a]);
    const initial = project.initial();
    expect(initial.program.getSourceFile(a)?.getText()).toContain("value = 1");

    writeFileSync(a, "export const value = 2;\n");
    const changed = project.refresh([a], [a]);
    expect(changed.services.languageService).toBe(initial.languageService);
    expect(changed.services.program).not.toBe(initial.program);
    expect(changed.services.program.getSourceFile(a)?.getText()).toContain("value = 2");
    expect(changed.projectVersion).toBe(1);

    writeFileSync(b, "export const second = true;\n");
    const added = project.refresh([a, b], [b]);
    expect(added.services.rootFileNames).toContain(path.resolve(b));
    expect(added.services.program.getSourceFile(b)).toBeDefined();

    unlinkSync(b);
    const removed = project.refresh([a], [b]);
    expect(removed.services.rootFileNames).not.toContain(path.resolve(b));
    expect(removed.services.program.getSourceFile(b)).toBeUndefined();

    project.dispose();
    expect(() => project.initial()).toThrow(/disposed/);
  });

  it("resolves repository modules from captured files instead of transient disk state", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tadori-project-capture-"));
    roots.push(root);
    const src = path.join(root, "src");
    mkdirSync(src);
    const target = path.join(src, "target.ts");
    const consumer = path.join(src, "consumer.ts");
    const targetText = "export function target(): number { return 1; }\n";
    const consumerText = 'import { target } from "./target.js";\nexport const result = target();\n';
    writeFileSync(target, targetText);
    writeFileSync(consumer, consumerText);
    const captured = new Map([
      [target, targetText],
      [consumer, consumerText]
    ]);
    unlinkSync(target);
    writeFileSync(path.join(src, "transient.ts"), "export const transient = true;\n");

    const services = createProjectServices(root, [target, consumer], captured);
    try {
      expect(services.program.getSourceFile(target)?.getText()).toBe(targetText);
      const resolvedTarget = ts.resolveModuleName(
          "./target.js",
          consumer,
          services.compilerOptions,
          services.moduleResolutionHost
        ).resolvedModule?.resolvedFileName;
      expect(resolvedTarget === undefined ? undefined : path.resolve(resolvedTarget)).toBe(target);
      expect(services.moduleResolutionHost.fileExists(path.join(src, "transient.ts"))).toBe(false);
    } finally {
      services.languageService.dispose();
    }
  });
});
