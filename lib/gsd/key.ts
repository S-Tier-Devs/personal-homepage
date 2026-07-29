import { postgresErrorCode } from "@/lib/dashboard/api";
import { getDb } from "@/lib/db/client";
import { gsdConfig } from "@/lib/db/schema";

/**
 * Resolves the Project-GSD API key from the gsd_config row via Drizzle.
 *
 * Returns null when unconfigured. A query error also resolves to null (and
 * is logged) so callers surface the same not-configured state instead of a
 * fake server fault; the Settings card is the remedy either way.
 *
 * No caching: rotation (PUT /api/gsd-key) must take effect on the very next
 * request, so every call re-reads the row.
 *
 * Isolated in its own module so lib/gsd/client.test.ts can stub this one
 * seam (vi.mock) without importing Drizzle mocks. Nothing here may log the
 * key value.
 */
export async function resolveGsdKey(): Promise<string | null> {
  try {
    const rows = await getDb().select({ api_key: gsdConfig.api_key }).from(gsdConfig).limit(1);

    return rows[0]?.api_key ?? null;
  } catch (error) {
    // Only the SQLSTATE and message — never the raw error object, which
    // could carry the key via a driver's query-echo behavior.
    console.error(
      "GSD key lookup error:",
      postgresErrorCode(error),
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}
