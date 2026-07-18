export interface ServeFlags {
  port: number | null;
  open: boolean;
  reindex: boolean;
  mode: "2d" | "2.5d" | "3d-experiment";
  snapshotId: number | null;
}

const MODES = new Set(["2d", "2.5d", "3d-experiment"]);

export type ParseServeFlagsResult =
  | { ok: true; flags: ServeFlags }
  | { ok: false; error: string };

/** Parses the five frozen `tadori serve` flags (docs/CLI_CONTRACT.md). */
export function parseServeFlags(argv: readonly string[]): ParseServeFlagsResult {
  const flags: ServeFlags = {
    port: null,
    open: true,
    reindex: false,
    mode: "2d",
    snapshotId: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--port": {
        const value = argv[index + 1];
        const parsed = value === undefined ? NaN : Number(value);
        if (value === undefined || !Number.isFinite(parsed)) {
          return { ok: false, error: "--port requires a number" };
        }
        flags.port = parsed;
        index += 1;
        break;
      }
      case "--no-open": {
        flags.open = false;
        break;
      }
      case "--reindex": {
        flags.reindex = true;
        break;
      }
      case "--mode": {
        const value = argv[index + 1];
        if (value === undefined || !MODES.has(value)) {
          return { ok: false, error: `Unknown mode ${String(value)}` };
        }
        flags.mode = value as ServeFlags["mode"];
        index += 1;
        break;
      }
      case "--snapshot": {
        const value = argv[index + 1];
        const parsed = value === undefined ? NaN : Number(value);
        if (value === undefined || !Number.isFinite(parsed)) {
          return { ok: false, error: "--snapshot requires a numeric id" };
        }
        flags.snapshotId = parsed;
        index += 1;
        break;
      }
      default: {
        return { ok: false, error: `Unknown flag ${flag}` };
      }
    }
  }
  return { ok: true, flags };
}
