import { desc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import { apiError, findMatchingCategory, normalizeUrl, readJsonObject } from "@/lib/dashboard/api";
import { isCtx, type LinkItem } from "@/lib/dashboard/types";
import { dashboardLinks } from "@/lib/db/schema";

/**
 * GET /api/links
 * Lists every link the admin owns, newest first — the design's default "Recent"
 * sort. Optional `?ctx=work|home` narrows to one workspace; the dashboard page
 * omits it and filters client-side so switching workspaces needs no refetch.
 */
export async function GET(request: NextRequest) {
  // Auth first, before any query or body work: RLS is defense in depth here,
  // not the only gate.
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;
  const ctxParam = request.nextUrl.searchParams.get("ctx");

  if (ctxParam !== null && !isCtx(ctxParam)) {
    return apiError("INVALID_CTX", "ctx must be either \"work\" or \"home\".", 400);
  }

  try {
    // Drizzle types `ctx` as plain `text` (drizzle-kit doesn't model the check
    // constraint as an enum), so the row type is wider than `LinkItem`. The
    // database's check constraint guarantees the narrower union at runtime,
    // same cast used for the category twins in lib/dashboard/api.ts.
    const links = (await db
      .select()
      .from(dashboardLinks)
      .where(ctxParam !== null ? eq(dashboardLinks.ctx, ctxParam) : undefined)
      .orderBy(desc(dashboardLinks.created_at))) as LinkItem[];

    return NextResponse.json({ links }, { status: 200 });
  } catch (error) {
    console.error("Links list error:", error);
    return apiError("SERVER_ERROR", "Could not load links.", 500);
  }
}

/**
 * POST /api/links
 * Creates a link. The URL is normalized (a missing scheme becomes `https://`,
 * matching the design) before validation, and only http/https survive — these
 * values are rendered as hrefs, so the scheme check is a real XSS gate.
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

  const { ctx, title, url, category_id: categoryId, description } = body;

  if (!isCtx(ctx)) {
    return apiError("INVALID_CTX", "ctx must be either \"work\" or \"home\".", 400);
  }

  if (typeof title !== "string" || !title.trim()) {
    return apiError("INVALID_BODY", "title is required.", 400);
  }

  if (typeof url !== "string") {
    return apiError("INVALID_BODY", "url is required.", 400);
  }

  const normalizedUrl = normalizeUrl(url);

  if (!normalizedUrl) {
    return apiError("INVALID_URL", "url must be a valid http or https address.", 400);
  }

  if (typeof categoryId !== "string" || !categoryId) {
    return apiError("INVALID_BODY", "category_id is required.", 400);
  }

  if (description !== undefined && description !== null && typeof description !== "string") {
    return apiError("INVALID_BODY", "description must be a string.", 400);
  }

  const category = await findMatchingCategory(db, categoryId, ctx, "link");

  if (!category) {
    return apiError(
      "INVALID_CATEGORY",
      "category_id must be a link category in the same workspace.",
      400
    );
  }

  try {
    const [link] = (await db
      .insert(dashboardLinks)
      .values({
        ctx,
        category_id: categoryId,
        title: title.trim(),
        url: normalizedUrl,
        description: typeof description === "string" ? description.trim() || null : null,
      })
      .returning()) as LinkItem[];

    return NextResponse.json(link, { status: 201 });
  } catch (error) {
    console.error("Link create error:", error);
    return apiError("SERVER_ERROR", "Could not save the link.", 500);
  }
}
