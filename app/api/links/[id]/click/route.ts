import { eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import { apiError, isUuid, logQueryError } from "@/lib/dashboard/api";
import type { LinkItem } from "@/lib/dashboard/types";
import { dashboardLinks } from "@/lib/db/schema";

/**
 * POST /api/links/[id]/click
 *
 * Atomically increments the link's click_count (and last_clicked_at) via a
 * single UPDATE, gated by the same admin auth every other route uses. Returns
 * the updated link entity (200); an unknown id comes back as an empty
 * `.returning()` and is a 404.
 *
 * Called by navigator.sendBeacon, which ignores the response; the body exists
 * for the wire convention and for reading the stored value in verification.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;
  const { id } = await params;

  if (!isUuid(id)) {
    return apiError("NOT_FOUND", "No link with that id.", 404);
  }

  try {
    // Drizzle types `ctx` as plain `text`, wider than `LinkItem`'s `Ctx` union;
    // the check constraint guarantees the narrower type at runtime, same cast
    // used for the category twins in lib/dashboard/api.ts.
    const [updated] = (await db
      .update(dashboardLinks)
      .set({
        click_count: sql`${dashboardLinks.click_count} + 1`,
        last_clicked_at: sql`timezone('utc'::text, now())`,
      })
      .where(eq(dashboardLinks.id, id))
      .returning()) as LinkItem[];

    if (!updated) {
      return apiError("NOT_FOUND", "No link with that id.", 404);
    }

    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    logQueryError("Link click increment error:", error);
    return apiError("SERVER_ERROR", "Could not record the click.", 500);
  }
}
