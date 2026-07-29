import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Single process-wide pool. basic-xxs (1 instance) against the shared 1GB
 * apps-pg cluster: 4 connections is plenty for a single-admin dashboard and
 * leaves headroom for gsd. Never raise this without checking the cluster's
 * connection limit and gsd's pool size.
 */
export const POOL_MAX = 4;

export function parseTimestamptz(value: string): string {
  return value;
}

/**
 * postgres.js type parser overrides that make timestamptz/timestamp/date
 * columns come back as ISO strings, not Date objects. PostgREST served these
 * as strings; the wire format and every formatDate call site depend on that
 * contract holding (plan Global Constraints). mode:"string" on the Drizzle
 * columns handles typing; this config handles the runtime values.
 *
 * Exported — and passed to postgres() by reference, not re-literaled — so
 * client.test.ts can assert against the exact object the driver receives.
 * A standalone constant tested in isolation would stay green even if this
 * config were deleted from the real postgres() call; this doesn't.
 */
export const TIMESTAMP_TYPE_CONFIG = {
  // `from` must stay a mutable number[] — the `postgres` package's
  // PostgresType interface requires it, so this object can't be `as const`.
  timestamptz: { to: 1184, from: [1184], serialize: (v: string) => v, parse: parseTimestamptz },
  timestamp: { to: 1114, from: [1114], serialize: (v: string) => v, parse: parseTimestamptz },
  date: { to: 1082, from: [1082], serialize: (v: string) => v, parse: parseTimestamptz },
};

/**
 * OIDs covered by TIMESTAMP_TYPE_CONFIG, derived rather than hand-maintained
 * as a second list — two lists that must be kept in sync is exactly the kind
 * of drift this config exists to prevent.
 */
export const TIMESTAMP_PARSER_IDS = Object.values(TIMESTAMP_TYPE_CONFIG).map((entry) => entry.to);

function buildDb() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }

  const client = postgres(url, {
    max: POOL_MAX,
    types: TIMESTAMP_TYPE_CONFIG,
  });

  return drizzle(client, { schema });
}

export type DrizzleDb = ReturnType<typeof buildDb>;

/**
 * Next.js dev/HMR re-evaluates modules; cache the pool on globalThis so dev
 * doesn't leak connections. In production this is one module instance anyway.
 */
const globalForDb = globalThis as unknown as { __homepageDb?: DrizzleDb };

export function getDb(): DrizzleDb {
  if (!globalForDb.__homepageDb) {
    globalForDb.__homepageDb = buildDb();
  }

  return globalForDb.__homepageDb;
}
