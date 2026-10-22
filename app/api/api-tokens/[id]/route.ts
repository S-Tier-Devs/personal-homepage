import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import { apiError, isUuid, logQueryError } from "@/lib/dashboard/api";
import { apiTokens } from "@/lib/db/schema";

/**
 * DELETE /api/api-tokens/[id] — soft revoke (sets revoked_at), so
 * blog_post_events rows keep a resolvable token reference. Session-only.
 * Revoking an already-revoked token is a 404: nothing changed.
 */
export async function DELETE(
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
    return apiError("NOT_FOUND", "No token with that id.", 404);
  }

  try {
    const revoked = await db
      .update(apiTokens)
      .set({ revoked_at: sql`timezone('utc'::text, now())` })
      .where(and(eq(apiTokens.id, id), isNull(apiTokens.revoked_at)))
      .returning({ id: apiTokens.id });

    if (revoked.length === 0) {
      return apiError("NOT_FOUND", "No active token with that id.", 404);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    logQueryError("Token revoke error:", error);
    return apiError("SERVER_ERROR", "Could not revoke the token.", 500);
  }
}
