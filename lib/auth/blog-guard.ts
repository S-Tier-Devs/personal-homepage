import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { isAdminEmail } from "@/lib/auth/admin";
import { verifyClaims } from "@/lib/auth/claims";
import {
  TOKEN_DISPLAY_PREFIX_LENGTH,
  hashApiToken,
  isWellFormedToken,
} from "@/lib/auth/tokens";
import { logQueryError } from "@/lib/dashboard/api";
import { getDb, type DrizzleDb } from "@/lib/db/client";
import { apiTokens } from "@/lib/db/schema";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Second auth guard, used ONLY by routes under app/api/blog/** — a unit test
 * (lib/auth/blog-guard-scope.test.ts) enforces that, so a leaked blog token
 * can touch blog posts and blog media and nothing else. Token management
 * routes use requireAdminAuth: a token cannot mint or revoke tokens.
 *
 * A present-but-invalid Authorization header is a 401 and NEVER falls back to
 * the cookie session — otherwise a broken token would silently ride the
 * owner's session and misattribute agent writes as "admin".
 *
 * Deliberate omissions (spec → Authorization): no rate limiting (256-bit
 * tokens make online guessing infeasible; App Platform has no shared store)
 * and no token expiry (revocation + last_used_at cover the risk at T0).
 */

export type BlogActor =
  | { kind: "admin"; userId: string }
  | { kind: "agent"; tokenId: string };

type BlogAuthResult =
  | { actor: BlogActor; db: DrizzleDb; error?: undefined }
  | { error: NextResponse; actor?: undefined };

const LAST_USED_THROTTLE_MS = 60_000;

function unauthenticated(message: string): BlogAuthResult {
  return {
    error: NextResponse.json({ error: "UNAUTHENTICATED", message }, { status: 401 }),
  };
}

export async function requireBlogAuth(request: NextRequest): Promise<BlogAuthResult> {
  const header = request.headers.get("authorization");

  if (header !== null) {
    return authenticateToken(header);
  }

  return authenticateSession();
}

async function authenticateToken(header: string): Promise<BlogAuthResult> {
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim() ?? "";

  if (!isWellFormedToken(token)) {
    return unauthenticated("Authorization header must carry a valid bearer token.");
  }

  const db = getDb();

  try {
    const rows = await db
      .select({
        id: apiTokens.id,
        last_used_at: apiTokens.last_used_at,
      })
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.token_hash, hashApiToken(token)),
          isNull(apiTokens.revoked_at),
          sql`'blog' = any(${apiTokens.scopes})`
        )
      )
      .limit(1);

    const row = rows[0];

    if (!row) {
      // Prefix only — the full value must never reach a log line.
      console.error(
        "Blog token rejected:",
        token.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH)
      );
      return unauthenticated("Unknown, revoked, or out-of-scope token.");
    }

    const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;

    if (Number.isNaN(lastUsed) || Date.now() - lastUsed >= LAST_USED_THROTTLE_MS) {
      try {
        await db
          .update(apiTokens)
          .set({ last_used_at: sql`timezone('utc'::text, now())` })
          .where(eq(apiTokens.id, row.id));
      } catch (error) {
        // Visibility metadata only — never fail the request over it.
        logQueryError("Token last_used_at update error:", error);
      }
    }

    return { actor: { kind: "agent", tokenId: row.id }, db };
  } catch (error) {
    logQueryError("Blog token lookup error:", error);
    return {
      error: NextResponse.json(
        { error: "INTERNAL_ERROR", message: "Internal server error." },
        { status: 500 }
      ),
    };
  }
}

/** Mirrors requireAdminAuth (lib/auth/admin-guard.ts) — same checks, same codes. */
async function authenticateSession(): Promise<BlogAuthResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const claims = await verifyClaims(supabase);

    if (!claims) {
      return unauthenticated("No authenticated session.");
    }

    if (!isAdminEmail(claims.email)) {
      return {
        error: NextResponse.json(
          { error: "FORBIDDEN", message: "Admin access required." },
          { status: 403 }
        ),
      };
    }

    return { actor: { kind: "admin", userId: claims.id }, db: getDb() };
  } catch (err) {
    console.error("Blog auth guard error:", err);
    return {
      error: NextResponse.json(
        { error: "INTERNAL_ERROR", message: "Internal server error." },
        { status: 500 }
      ),
    };
  }
}
