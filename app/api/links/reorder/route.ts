import { asc, eq, inArray } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import { apiError, isUuid, readJsonObject } from "@/lib/dashboard/api";
import type { LinkItem } from "@/lib/dashboard/types";
import { dashboardLinks } from "@/lib/db/schema";

/**
 * A drop rewrites every position in the affected list, so the cap is a sanity
 * bound on a hand-curated list, not a real limit anyone should reach.
 */
const MAX_REORDER_ROWS = 500;

/**
 * PATCH /api/links/reorder
 *
 * Applies a manual ordering as one batch: a drag writes every row's position in
 * a single request rather than one request per moved row.
 *
 * Responds with `{ links }` — the full list for the affected workspace, freshly
 * read — so the client replaces its optimistic state with what was actually
 * stored rather than assuming its own guess was right.
 */
export async function PATCH(request: NextRequest) {
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;
  const body = await readJsonObject(request);

  if (!body) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  const { order } = body;

  if (!Array.isArray(order) || order.length === 0) {
    return apiError("INVALID_BODY", "order must be a non-empty array.", 400);
  }

  if (order.length > MAX_REORDER_ROWS) {
    return apiError("INVALID_BODY", `order must hold at most ${MAX_REORDER_ROWS} rows.`, 400);
  }

  const positions = new Map<string, number>();

  for (const entry of order) {
    if (typeof entry !== "object" || entry === null) {
      return apiError("INVALID_BODY", "Each order entry must be an object.", 400);
    }

    const { id, sort_order: sortOrder } = entry as {
      id?: unknown;
      sort_order?: unknown;
    };

    // Guarding here keeps a malformed id from reaching Postgres as a 22P02 and
    // surfacing as a 500.
    if (typeof id !== "string" || !isUuid(id)) {
      return apiError("INVALID_BODY", "Each order entry needs a valid id.", 400);
    }

    if (typeof sortOrder !== "number" || !Number.isInteger(sortOrder)) {
      return apiError("INVALID_BODY", "Each order entry needs an integer sort_order.", 400);
    }

    if (positions.has(id)) {
      return apiError("INVALID_BODY", "order must not repeat an id.", 400);
    }

    positions.set(id, sortOrder);
  }

  const ids = [...positions.keys()];

  // Read first, for two reasons: it confirms every id is a row this caller can
  // see, and it gives us the ctx to scope the response to without trusting a
  // client-supplied workspace.
  let rows: LinkItem[];

  try {
    // Drizzle types `ctx` as plain `text`, wider than `LinkItem`'s `Ctx` union;
    // the check constraint guarantees the narrower type at runtime, same cast
    // used for the category twins in lib/dashboard/api.ts.
    rows = (await db.select().from(dashboardLinks).where(inArray(dashboardLinks.id, ids))) as LinkItem[];
  } catch (error) {
    console.error("Link reorder read error:", error);
    return apiError("SERVER_ERROR", "Could not load the links.", 500);
  }

  if (rows.length !== ids.length) {
    return apiError("NOT_FOUND", "One or more links no longer exist.", 404);
  }

  // A reorder is meaningless across workspaces, and allowing it would let one
  // drag interleave two lists.
  const contexts = new Set(rows.map((row) => row.ctx));

  if (contexts.size > 1) {
    return apiError("INVALID_BODY", "order must not span workspaces.", 400);
  }

  const [ctx] = [...contexts];

  // Sequential rather than a single upsert: an upsert would need every non-null
  // column restated, which risks clobbering a title edit that landed between
  // this client's read and its drop.
  for (const row of rows) {
    const sortOrder = positions.get(row.id);

    if (sortOrder === undefined || sortOrder === row.sort_order) {
      continue;
    }

    try {
      await db.update(dashboardLinks).set({ sort_order: sortOrder }).where(eq(dashboardLinks.id, row.id));
    } catch (error) {
      // Honest limitation: these per-row updates are NOT wrapped in a single
      // transaction, so a failure here can leave the list half-renumbered —
      // the rows before this one are already updated, the rest are not, and
      // the client receives a 500 without the resulting order. It is
      // self-recoverable (re-issuing the same reorder converges the list, and
      // the client rolls its optimistic state back on this 500), and the batch
      // is capped at MAX_REORDER_ROWS, so the blast radius is bounded. Making
      // the batch atomic needs a Postgres function (a single UPDATE ... FROM
      // over the batch); deferred as an owner decision rather than assumed.
      console.error("Link reorder write error:", error);
      return apiError("SERVER_ERROR", "Could not save the new order.", 500);
    }
  }

  try {
    const links = (await db
      .select()
      .from(dashboardLinks)
      .where(eq(dashboardLinks.ctx, ctx))
      .orderBy(asc(dashboardLinks.sort_order))) as LinkItem[];

    return NextResponse.json({ links }, { status: 200 });
  } catch (error) {
    console.error("Link reorder reload error:", error);
    return apiError("SERVER_ERROR", "Could not reload the links.", 500);
  }
}
