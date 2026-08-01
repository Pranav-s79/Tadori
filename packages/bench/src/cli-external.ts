import {
  closeSync,
  fsyncSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runExternalValidationSuite } from "./externalValidation.js";

interface Arguments {
  checkoutRoot: string;
  output: string | null;
}

function usage(): string {
  return "Usage: pnpm external:validate -- --checkout-root <directory> [--output <report.json>]";
}

function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function parseExternalValidationArguments(argv: readonly string[]): Arguments {
  let checkoutRoot: string | null = null;
  let output: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if ((argument === "--checkout-root" || argument === "--output") && value === undefined) {
      throw new Error(`${argument} requires a value`);
    }
    if (argument === "--checkout-root") {
      if (checkoutRoot !== null) throw new Error("--checkout-root may be specified only once");
      checkoutRoot = path.resolve(value as string);
      index += 1;
    } else if (argument === "--output") {
      if (output !== null) throw new Error("--output may be specified only once");
      output = path.resolve(value as string);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${String(argument)}`);
    }
  }
  if (checkoutRoot === null) throw new Error("--checkout-root is required");
  return { checkoutRoot, output };
}

export function assertExternalReportOutput(output: string, checkoutRoot: string): void {
  if (path.basename(output) !== "external-validation-results.json") {
    throw new Error("--output filename must be external-validation-results.json");
  }
  const canonicalCheckoutRoot = realpathSync.native(path.resolve(checkoutRoot));
  const canonicalOutputParent = realpathSync.native(path.dirname(path.resolve(output)));
  const canonicalOutput = path.join(canonicalOutputParent, path.basename(output));
  if (isWithin(canonicalOutput, canonicalCheckoutRoot)) {
    throw new Error("--output must be outside the external checkout root");
  }
}

export function writeExternalReportAtomically(output: string, serialized: string): void {
  const temporary = `${output}.${String(process.pid)}.${randomUUID()}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, "wx");
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, output);
    if (process.platform !== "win32") {
      const parentDescriptor = openSync(path.dirname(output), "r");
      try {
        fsyncSync(parentDescriptor);
      } finally {
        closeSync(parentDescriptor);
      }
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

function main(argv: readonly string[]): number {
  try {
    const args = parseExternalValidationArguments(argv);
    if (args.output !== null) assertExternalReportOutput(args.output, args.checkoutRoot);
    const report = runExternalValidationSuite(args.checkoutRoot, process.cwd());
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (args.output !== null) writeExternalReportAtomically(args.output, serialized);
    process.stdout.write(serialized);
    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n${usage()}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
