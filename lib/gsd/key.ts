import { logQueryError } from "@/lib/dashboard/api";
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
    // This SELECT has no sensitive params, but every gsd_config log path
    // follows the same never-log-the-wrapper rule as app/api/gsd-key/route.ts
    // via the shared logQueryError helper (lib/dashboard/api.ts).
    logQueryError("GSD key lookup error:", error);
    return null;
  }
}
