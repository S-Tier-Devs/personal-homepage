import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import {
  apiError,
  findMatchingCategory,
  isUuid,
  logQueryError,
  readJsonObject,
} from "@/lib/dashboard/api";
import { isCtx, type Ctx, type NoteItem } from "@/lib/dashboard/types";
import { dashboardNotes } from "@/lib/db/schema";
import {
  NOTE_CONTENT_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
  sanitizeNoteHtml,
} from "@/lib/sanitize";

/**
 * Only the columns PATCH is allowed to write; every key is optional.
 *
 * `updated_at` is deliberately absent: the schema's `$onUpdate` owns it, and
 * the "Recent" sort would be wrong if the API raced it.
 */
interface NoteUpdate {
  ctx?: Ctx;
  title?: string;
  content_html?: string;
  category_id?: string;
}

/**
 * PATCH /api/notes/[id]
 * Partial update, and the endpoint the editor's debounced autosave calls. Any
 * field that is present is validated by the same rules as POST; absent fields
 * are left untouched.
 *
 * Unlike links, an empty `title` is valid — a note may genuinely be untitled,
 * and the list renders "Untitled" for it.
 *
 * `ctx` and `category_id` are validated together against their *effective*
 * values, so moving a note between workspaces without also moving its category
 * (or vice versa) is rejected rather than silently storing a mismatched pair.
 */
export async function PATCH(
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
    return apiError("NOT_FOUND", "No note with that id.", 404);
  }

  const body = await readJsonObject(request);

  if (!body) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  let existing: NoteItem | undefined;

  try {
    // Drizzle types `ctx` as plain `text`, wider than `NoteItem`'s `Ctx` union;
    // the check constraint guarantees the narrower type at runtime, same cast
    // used for the category twins in lib/dashboard/api.ts.
    const rows = (await db
      .select()
      .from(dashboardNotes)
      .where(eq(dashboardNotes.id, id))
      .limit(1)) as NoteItem[];

    existing = rows[0];
  } catch (error) {
    logQueryError("Note read error:", error);
    return apiError("SERVER_ERROR", "Could not load the note.", 500);
  }

  if (!existing) {
    return apiError("NOT_FOUND", "No note with that id.", 404);
  }

  const current: NoteItem = existing;
  const updates: NoteUpdate = {};

  if ("ctx" in body) {
    if (!isCtx(body.ctx)) {
      return apiError("INVALID_CTX", "ctx must be either \"work\" or \"home\".", 400);
    }

    updates.ctx = body.ctx;
  }

  if ("title" in body) {
    if (typeof body.title !== "string") {
      return apiError("INVALID_BODY", "title must be a string.", 400);
    }

    if (body.title.length > NOTE_TITLE_MAX_LENGTH) {
      return apiError(
        "INVALID_TITLE",
        `title must be ${NOTE_TITLE_MAX_LENGTH} characters or fewer.`,
        400
      );
    }

    updates.title = body.title.trim();
  }

  if ("content_html" in body) {
    if (typeof body.content_html !== "string") {
      return apiError("INVALID_BODY", "content_html must be a string.", 400);
    }

    // Checked before sanitizing so an enormous paste is refused, not parsed.
    if (body.content_html.length > NOTE_CONTENT_MAX_LENGTH) {
      return apiError(
        "INVALID_CONTENT",
        `content_html must be ${NOTE_CONTENT_MAX_LENGTH} characters or fewer.`,
        400
      );
    }

    updates.content_html = sanitizeNoteHtml(body.content_html);
  }

  if ("category_id" in body) {
    if (typeof body.category_id !== "string" || !body.category_id) {
      return apiError("INVALID_BODY", "category_id must be a string.", 400);
    }

    updates.category_id = body.category_id;
  }

  if (Object.keys(updates).length === 0) {
    return apiError("INVALID_BODY", "No updatable fields were provided.", 400);
  }

  // Re-check the pairing whenever either half of it moves.
  if (updates.ctx !== undefined || updates.category_id !== undefined) {
    const effectiveCtx = updates.ctx ?? current.ctx;
    const effectiveCategoryId = updates.category_id ?? current.category_id;
    const category = await findMatchingCategory(db, effectiveCategoryId, effectiveCtx, "note");

    if (!category) {
      return apiError(
        "INVALID_CATEGORY",
        "category_id must be a note category in the same workspace.",
        400
      );
    }
  }

  try {
    const [note] = (await db
      .update(dashboardNotes)
      .set(updates)
      .where(eq(dashboardNotes.id, id))
      .returning()) as NoteItem[];

    if (!note) {
      return apiError("NOT_FOUND", "No note with that id.", 404);
    }

    return NextResponse.json(note, { status: 200 });
  } catch (error) {
    logQueryError("Note update error:", error);
    return apiError("SERVER_ERROR", "Could not update the note.", 500);
  }
}

/**
 * DELETE /api/notes/[id]
 * Returns 404 when nothing was deleted, so an optimistic client can tell a
 * genuine failure from a row that was already gone.
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
    return apiError("NOT_FOUND", "No note with that id.", 404);
  }

  try {
    const deleted = await db
      .delete(dashboardNotes)
      .where(eq(dashboardNotes.id, id))
      .returning({ id: dashboardNotes.id });

    if (deleted.length === 0) {
      return apiError("NOT_FOUND", "No note with that id.", 404);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    logQueryError("Note delete error:", error);
    return apiError("SERVER_ERROR", "Could not delete the note.", 500);
  }
}
