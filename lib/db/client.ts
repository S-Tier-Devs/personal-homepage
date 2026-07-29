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

/** postgres.js type OIDs overridden to return strings: timestamptz, timestamp. */
export const TIMESTAMP_PARSER_IDS = [1184, 1114] as const;

export function parseTimestamptz(value: string): string {
  return value;
}

function buildDb() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }

  const client = postgres(url, {
    max: POOL_MAX,
    // PostgREST served timestamps as ISO strings; keep that contract so the
    // wire format and formatDate call sites are unchanged (plan Global
    // Constraints). mode:"string" on the Drizzle columns handles typing;
    // these parsers handle the runtime values.
    types: {
      timestamptz: { to: 1184, from: [1184], serialize: (v: string) => v, parse: parseTimestamptz },
      timestamp: { to: 1114, from: [1114], serialize: (v: string) => v, parse: parseTimestamptz },
    },
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
