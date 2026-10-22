import { desc } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import { mintApiToken } from "@/lib/auth/tokens";
import { apiError, logQueryError, readJsonObject } from "@/lib/dashboard/api";
import { apiTokens } from "@/lib/db/schema";
import type { ApiTokenMeta } from "@/lib/blog/types";

/** Everything but token_hash — the hash never leaves the database. */
const TOKEN_META_FIELDS = {
  id: apiTokens.id,
  name: apiTokens.name,
  token_prefix: apiTokens.token_prefix,
  scopes: apiTokens.scopes,
  created_at: apiTokens.created_at,
  last_used_at: apiTokens.last_used_at,
  revoked_at: apiTokens.revoked_at,
};

const TOKEN_NAME_MAX_LENGTH = 100;

/**
 * GET /api/api-tokens — list token metadata, newest first.
 * Session-only (requireAdminAuth): a token cannot list tokens.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;

  try {
    const tokens = (await db
      .select(TOKEN_META_FIELDS)
      .from(apiTokens)
      .orderBy(desc(apiTokens.created_at))) as ApiTokenMeta[];

    return NextResponse.json({ tokens }, { status: 200 });
  } catch (error) {
    logQueryError("Token list error:", error);
    return apiError("SERVER_ERROR", "Could not load tokens.", 500);
  }
}

/**
 * POST /api/api-tokens — mint a blog-scoped token. The response is the ONLY
 * time the token value exists outside the caller's hands; it is never stored
 * or returned again.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;
  const body = await readJsonObject(request);

  if (!body) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name || name.length > TOKEN_NAME_MAX_LENGTH) {
    return apiError(
      "INVALID_BODY",
      `name is required (≤ ${TOKEN_NAME_MAX_LENGTH} chars).`,
      400
    );
  }

  const minted = mintApiToken();

  try {
    const [row] = (await db
      .insert(apiTokens)
      .values({
        name,
        token_hash: minted.hash,
        token_prefix: minted.prefix,
        scopes: ["blog"],
      })
      .returning(TOKEN_META_FIELDS)) as ApiTokenMeta[];

    return NextResponse.json({ ...row, token: minted.token }, { status: 201 });
  } catch (error) {
    logQueryError("Token create error:", error);
    return apiError("SERVER_ERROR", "Could not create the token.", 500);
  }
}
