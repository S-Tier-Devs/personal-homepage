import { asc } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import {
  CATEGORY_NAME_MAX_LENGTH,
  UNIQUE_VIOLATION,
  apiError,
  listCategorySiblings,
  normalizeCategoryName,
  postgresErrorCode,
  readJsonObject,
} from "@/lib/dashboard/api";
import { isCategoryKind, isCtx, type Category } from "@/lib/dashboard/types";
import { dashboardCategories } from "@/lib/db/schema";

/**
 * The wire shape for a category: `dashboard_categories` also has a
 * `created_at` column (carried for the schema's own bookkeeping), but the
 * `Category` contract never included it — the Supabase-era routes selected
 * "id, ctx, kind, name, sort_order" rather than `*`. An
 * unqualified `db.select().from(dashboardCategories)` would pull every
 * column, so every select/insert/update that returns a category to the
 * client names its fields explicitly to keep the response byte-for-byte
 * identical to the Supabase-era one.
 */
const CATEGORY_FIELDS = {
  id: dashboardCategories.id,
  ctx: dashboardCategories.ctx,
  kind: dashboardCategories.kind,
  name: dashboardCategories.name,
  sort_order: dashboardCategories.sort_order,
};

/**
 * GET /api/categories
 * Returns every category for both workspaces and both kinds. The row count is
 * tiny and the dashboard needs the whole set to render its filters, so the
 * client slices by ctx and kind rather than asking the server per view.
 *
 * The Settings section is the one consumer that slices by neither: it shows
 * both workspaces side by side.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;

  try {
    // Drizzle types `ctx`/`kind` as plain `text` (drizzle-kit doesn't model the
    // check constraints as enums), so the row type is wider than `Category`.
    // The database's check constraints guarantee the narrower union at
    // runtime, same cast used for the category twins in lib/dashboard/api.ts.
    const categories = (await db
      .select(CATEGORY_FIELDS)
      .from(dashboardCategories)
      .orderBy(
        asc(dashboardCategories.ctx),
        asc(dashboardCategories.kind),
        asc(dashboardCategories.sort_order)
      )) as Category[];

    return NextResponse.json({ categories }, { status: 200 });
  } catch (error) {
    console.error("Categories list error:", error);
    return apiError("SERVER_ERROR", "Could not load categories.", 500);
  }
}

/**
 * POST /api/categories
 * Creates a category in one workspace/kind list. `sort_order` is appended to the
 * end of that list — the lists are hand-curated and short, so "newest last" is
 * the only ordering rule there is.
 *
 * Duplicates are rejected case-insensitively, matching the design's `addCat`
 * (design/patrick-beasley.dc.html line 608). The database's
 * `unique (ctx, kind, name)` is case-sensitive, so it is a backstop for the
 * concurrent case, not the primary check.
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

  const { ctx, kind, name } = body;

  if (!isCtx(ctx)) {
    return apiError("INVALID_CTX", "ctx must be either \"work\" or \"home\".", 400);
  }

  if (!isCategoryKind(kind)) {
    return apiError("INVALID_BODY", "kind must be either \"link\" or \"note\".", 400);
  }

  const trimmedName = normalizeCategoryName(name);

  if (!trimmedName) {
    return apiError(
      "INVALID_BODY",
      `name must be a non-empty string of at most ${CATEGORY_NAME_MAX_LENGTH} characters.`,
      400
    );
  }

  const siblings = await listCategorySiblings(db, ctx, kind);

  if (!siblings) {
    return apiError("SERVER_ERROR", "Could not save the category.", 500);
  }

  if (siblings.some((sibling) => sibling.name.toLowerCase() === trimmedName.toLowerCase())) {
    return apiError("CONFLICT", `“${trimmedName}” already exists in this list.`, 409);
  }

  // Max, not length: a future delete would otherwise make the next insert
  // collide with an existing position.
  const nextSortOrder =
    siblings.reduce((highest, sibling) => Math.max(highest, sibling.sort_order), -1) + 1;

  try {
    const [category] = (await db
      .insert(dashboardCategories)
      .values({ ctx, kind, name: trimmedName, sort_order: nextSortOrder })
      .returning(CATEGORY_FIELDS)) as Category[];

    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    // The case-insensitive check above only catches a pre-existing duplicate;
    // this is the net for a concurrent request that inserted the same
    // (ctx, kind, name) between the check and this write.
    if (postgresErrorCode(error) === UNIQUE_VIOLATION) {
      return apiError("CONFLICT", `“${trimmedName}” already exists in this list.`, 409);
    }

    console.error("Category create error:", error);
    return apiError("SERVER_ERROR", "Could not save the category.", 500);
  }
}
