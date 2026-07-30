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

/**
 * postgres.js returns timestamptz/timestamp values with its own formatting
 * quirks — a space instead of "T", and a bare two-digit UTC-style offset
 * ("+00") instead of one with explicit minutes ("+00:00") — rather than the
 * ISO 8601 shape PostgREST used to serve ("2026-07-29T13:26:14.684465+00:00").
 * Both are strings, so the mode:"string" contract holds, but the wire format
 * itself silently changed: V8's `Date` parser is lenient enough to accept
 * the postgres.js form, but the plan requires the wire format to be
 * unchanged byte-for-byte where observable (API responses), and it's not
 * valid ISO 8601 — engines with a stricter parser (iOS Safari has
 * historically been one) can fail to parse it at all.
 *
 * Normalizes the string in place — deliberately not a `new Date(v)`
 * round-trip, which would truncate to millisecond precision and discard the
 * microseconds Postgres (and PostgREST) preserved. Used for all three OIDs
 * below: a `date` has no time component to normalize and is returned as-is.
 */
export function normalizeTemporalText(value: string): string {
  if (!value.includes(" ")) {
    // A `date` (OID 1082, e.g. "2026-07-29") — nothing to normalize.
    return value;
  }

  // "YYYY-MM-DD HH:MM:SS[.ffffff]" -> "...T..." (ISO 8601's separator).
  let normalized = value.replace(" ", "T");

  // A trailing bare two-digit offset ("+00", "-05") needs an explicit ":00"
  // to be valid ISO 8601; one that already carries minutes ("+05:30") is
  // left untouched. Guarded by the space check above, so this can't misfire
  // on a date's day-of-month digits — a bare `date` never reaches this line.
  normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");

  return normalized;
}

/**
 * postgres.js type parser overrides that make timestamptz/timestamp/date
 * columns come back as ISO-shaped strings, not Date objects. PostgREST
 * served these as ISO strings; the wire format and every formatDate call
 * site depend on that contract holding (plan Global Constraints). mode:
 * "string" on the Drizzle columns handles typing; this config handles the
 * runtime values and their exact text shape.
 *
 * Exported — and passed to postgres() by reference, not re-literaled — so
 * client.test.ts can assert against the exact object the driver receives.
 * A standalone constant tested in isolation would stay green even if this
 * config were deleted from the real postgres() call; this doesn't.
 */
export const TIMESTAMP_TYPE_CONFIG = {
  // `from` must stay a mutable number[] — the `postgres` package's
  // PostgresType interface requires it, so this object can't be `as const`.
  timestamptz: { to: 1184, from: [1184], serialize: (v: string) => v, parse: normalizeTemporalText },
  timestamp: { to: 1114, from: [1114], serialize: (v: string) => v, parse: normalizeTemporalText },
  date: { to: 1082, from: [1082], serialize: (v: string) => v, parse: normalizeTemporalText },
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

  const db = drizzle(client, { schema });

  // LOAD-BEARING, not redundant: drizzle's postgres-js driver deliberately
  // overwrites the client's parsers/serializers for every temporal OID at
  // construction time (node_modules/drizzle-orm/postgres-js/driver.js,
  // `construct()`: it installs a transparent `(val) => val` parser for OIDs
  // 1184, 1082, 1083, 1114, 1182, 1185, 1115, 1231) — which silently discards
  // the TIMESTAMP_TYPE_CONFIG handed to postgres() above. The `types` option
  // stays on the postgres() call because it is the correct declaration; this
  // re-assertion after drizzle() is what actually survives and makes
  // normalizeTemporalText run in production. Without it, every timestamptz
  // reaches the app as "2026-07-29 15:34:18.209201+00" (non-ISO) instead of
  // "2026-07-29T15:34:18.209201+00:00". Deleting this loop must turn
  // lib/db/client.test.ts red.
  for (const oid of TIMESTAMP_PARSER_IDS) {
    client.options.parsers[oid] = normalizeTemporalText;
  }

  return db;
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
