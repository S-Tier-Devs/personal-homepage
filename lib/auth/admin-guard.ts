import { NextRequest, NextResponse } from "next/server";

import { isAdminEmail } from "@/lib/auth/admin";
import { verifyClaims } from "@/lib/auth/claims";
import { getDb } from "@/lib/db/client";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Middleware guard for admin-protected API routes.
 * Verifies user is authenticated and has admin email.
 * Returns { user, db } on success or NextResponse (401/403) on failure.
 * `db` is the Drizzle handle for `apps-pg`, and routes should consume it for
 * all data queries. A Supabase client is still created internally because
 * `verifyClaims` needs one for session verification (auth does not move until
 * Phase 3), but it is no longer part of the returned shape. Routes that still
 * need Supabase Storage (until Phase 2) create their own client with
 * `createServerSupabaseClient()` after calling this guard.
 */
export async function requireAdminAuth(_request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    const claims = await verifyClaims(supabase);

    if (!claims) {
      return {
        error: NextResponse.json(
          { error: "UNAUTHENTICATED", message: "No authenticated session." },
          { status: 401 }
        ),
      };
    }

    if (!isAdminEmail(claims.email)) {
      return {
        error: NextResponse.json(
          { error: "FORBIDDEN", message: "Admin access required." },
          { status: 403 }
        ),
      };
    }

    // `user` keeps its shape for app/api/files/upload/route.ts:94, which reads
    // `user.id` for the `uploaded_by` column.
    return { user: { id: claims.id, email: claims.email }, db: getDb() };
  } catch (err) {
    console.error("Admin auth guard error:", err);
    return {
      error: NextResponse.json(
        { error: "INTERNAL_ERROR", message: "Internal server error." },
        { status: 500 }
      ),
    };
  }
}
