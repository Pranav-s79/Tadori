import BetterSqlite3 from "better-sqlite3";
import { MIGRATIONS } from "./migrations.js";

export type Database = BetterSqlite3.Database;

export interface ForeignKeyViolation {
  table: string;
  rowid: number | bigint | null;
  parent: string;
  fkid: number;
}

/**
 * Opens (or creates) a Tadori database and applies the per-connection pragmas
 * the frozen schema expects. Migrations are NOT applied automatically; call
 * `runMigrations` explicitly.
 */
export function openDatabase(path: string): Database {
  const db = new BetterSqlite3(path);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  // Bound writer contention: refresh publication either acquires the lock
  // within five seconds or fails loudly and keeps the previous valid head.
  db.pragma("busy_timeout = 5000");
  return db;
}

function appliedVersions(db: Database): Set<number> {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{
    version: number;
  }>;
  return new Set(rows.map((r) => r.version));
}

/**
 * Applies all pending frozen migrations in order. Already-applied versions are
 * skipped (duplicate protection); versions must be contiguous from 1.
 */
export function runMigrations(db: Database): number[] {
  const applied = appliedVersions(db);
  const ran: number[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }
    try {
      db.exec(migration.sql);
    } catch (error) {
      if (db.inTransaction) {
        db.exec("ROLLBACK;");
      }
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed: ${String(error)}`
      );
    }
    ran.push(migration.version);
  }
  return ran;
}

/**
 * Forces a single migration to run regardless of the applied-version record.
 * Exists only so tests can prove that re-running an applied migration fails
 * instead of silently corrupting the schema.
 */
export function forceRunMigration(db: Database, version: number): void {
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) {
    throw new Error(`No frozen migration with version ${version}`);
  }
  try {
    db.exec(migration.sql);
  } finally {
    if (db.inTransaction) {
      db.exec("ROLLBACK;");
    }
  }
}

/** Runs `PRAGMA foreign_key_check`; a healthy database returns zero rows. */
export function foreignKeyCheck(db: Database): ForeignKeyViolation[] {
  return db.pragma("foreign_key_check") as ForeignKeyViolation[];
}
