import { and, desc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { requireBlogAuth } from "@/lib/auth/blog-guard";
import { recordPostEvent } from "@/lib/blog/events";
import {
  POST_EXCERPT_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
  isLive,
  isValidSlug,
  normalizeTags,
  parsePublishedAtInput,
  readingMinutes,
} from "@/lib/blog/posts";
import { revalidateBlog } from "@/lib/blog/revalidate";
import type { BlogPost, BlogPostEvent, PostAction } from "@/lib/blog/types";
import {
  UNIQUE_VIOLATION,
  apiError,
  isUuid,
  logQueryError,
  postgresErrorCode,
  readJsonObject,
} from "@/lib/dashboard/api";
import { blogPostEvents, blogPosts } from "@/lib/db/schema";
import type { DrizzleDb } from "@/lib/db/client";
import { getSpacesMediaCdnUrl } from "@/lib/env";
import { POST_CONTENT_MAX_LENGTH, sanitizePostHtml } from "@/lib/sanitize";

/** Only the columns PATCH may write; every key optional. */
interface PostUpdate {
  title?: string;
  slug?: string;
  excerpt?: string;
  content_html?: string;
  status?: "draft" | "published";
  published_at?: string | null;
  tags?: string[];
  reading_minutes?: number;
  updated_by?: "admin" | "agent";
  updated_by_token_id?: string | null;
}

/**
 * Thrown from inside the PATCH transaction when the atomic UPDATE (guarded by
 * if_updated_at) matches zero rows — a racing writer committed between the
 * pre-transaction read and this statement. Throwing aborts/rolls back the
 * transaction, so no event row survives a lost race; the outer catch turns
 * this into the same 409 CONFLICT the pre-check gives, before the generic
 * 23505 check.
 */
class PatchConflictError extends Error {}

async function loadPost(db: DrizzleDb, id: string): Promise<BlogPost | undefined> {
  const rows = (await db
    .select()
    .from(blogPosts)
    .where(eq(blogPosts.id, id))
    .limit(1)) as BlogPost[];

  return rows[0];
}

/** GET /api/blog/posts/[id] — full post + its last 20 events. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireBlogAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;
  const { id } = await params;

  if (!isUuid(id)) {
    return apiError("NOT_FOUND", "No post with that id.", 404);
  }

  try {
    const post = await loadPost(db, id);

    if (!post) {
      return apiError("NOT_FOUND", "No post with that id.", 404);
    }

    const events = (await db
      .select()
      .from(blogPostEvents)
      .where(eq(blogPostEvents.post_id, id))
      .orderBy(desc(blogPostEvents.created_at))
      .limit(20)) as BlogPostEvent[];

    return NextResponse.json({ ...post, events }, { status: 200 });
  } catch (error) {
    logQueryError("Post read error:", error);
    return apiError("SERVER_ERROR", "Could not load the post.", 500);
  }
}

/**
 * PATCH /api/blog/posts/[id] — partial update, same validation as POST.
 *
 * Concurrency: an optional `if_updated_at` must equal the stored updated_at
 * EXACTLY (string compare) or the request 409s — how an agent edit racing the
 * owner's open editor is surfaced instead of silently overwritten. That
 * pre-transaction check is advisory, fast feedback only: the atomic guard is
 * the UPDATE's own WHERE clause (id AND updated_at = if_updated_at), which is
 * what actually prevents two racing writers from both committing against the
 * same stale read.
 *
 * Slug lock: a LIVE post's slug cannot change (SLUG_LOCKED 409) — unpublish
 * first, deliberately, because renames break inbound links.
 *
 * published_at preservation: publishing keeps an existing published_at unless
 * one is explicitly supplied, and defaults to now only when null; unpublishing
 * never nulls it. The slug lock pushes the owner toward
 * unpublish → edit → republish, and that cycle must not reset the post's date.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireBlogAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { actor, db } = authResult;
  const { id } = await params;

  if (!isUuid(id)) {
    return apiError("NOT_FOUND", "No post with that id.", 404);
  }

  const body = await readJsonObject(request);

  if (!body) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  let existing: BlogPost | undefined;

  try {
    existing = await loadPost(db, id);
  } catch (error) {
    logQueryError("Post read error:", error);
    return apiError("SERVER_ERROR", "Could not load the post.", 500);
  }

  if (!existing) {
    return apiError("NOT_FOUND", "No post with that id.", 404);
  }

  let ifUpdatedAt: string | undefined;

  if ("if_updated_at" in body) {
    if (typeof body.if_updated_at !== "string") {
      return apiError("INVALID_BODY", "if_updated_at must be a string.", 400);
    }

    if (body.if_updated_at !== existing.updated_at) {
      return apiError(
        "CONFLICT",
        "This post changed since you loaded it — reload and retry.",
        409
      );
    }

    ifUpdatedAt = body.if_updated_at;
  }

  const updates: PostUpdate = {};
  const changed: string[] = [];

  if ("title" in body) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return apiError("INVALID_BODY", "title must be a non-empty string.", 400);
    }

    if (body.title.trim().length > POST_TITLE_MAX_LENGTH) {
      return apiError("INVALID_TITLE", `title must be ≤ ${POST_TITLE_MAX_LENGTH} chars.`, 400);
    }

    updates.title = body.title.trim();

    if (updates.title !== existing.title) changed.push("title");
  }

  if ("slug" in body) {
    if (typeof body.slug !== "string" || !isValidSlug(body.slug)) {
      return apiError(
        "INVALID_SLUG",
        "slug must be lowercase letters/digits with single hyphens, ≤ 100 chars.",
        400
      );
    }

    if (body.slug !== existing.slug) {
      if (isLive(existing)) {
        return apiError(
          "SLUG_LOCKED",
          "A live post's slug cannot change — unpublish first.",
          409
        );
      }

      updates.slug = body.slug;
      changed.push("slug");
    }
  }

  if ("excerpt" in body) {
    if (typeof body.excerpt !== "string") {
      return apiError("INVALID_BODY", "excerpt must be a string.", 400);
    }

    const excerpt = body.excerpt.trim();

    if (excerpt.length > POST_EXCERPT_MAX_LENGTH) {
      return apiError("INVALID_BODY", `excerpt must be ≤ ${POST_EXCERPT_MAX_LENGTH} chars.`, 400);
    }

    updates.excerpt = excerpt;

    if (excerpt !== existing.excerpt) changed.push("excerpt");
  }

  if ("content_html" in body) {
    if (typeof body.content_html !== "string") {
      return apiError("INVALID_BODY", "content_html must be a string.", 400);
    }

    if (body.content_html.length > POST_CONTENT_MAX_LENGTH) {
      return apiError("INVALID_CONTENT", "content_html is too large.", 400);
    }

    const contentHtml = sanitizePostHtml(body.content_html, {
      mediaOrigin: getSpacesMediaCdnUrl(),
    });

    updates.content_html = contentHtml;
    updates.reading_minutes = readingMinutes(contentHtml);

    if (contentHtml !== existing.content_html) changed.push("content");
  }

  if ("tags" in body) {
    const tags = normalizeTags(body.tags);

    if (tags === null) {
      return apiError(
        "INVALID_TAGS",
        "tags must be ≤ 8 strings of lowercase letters, digits, hyphens (≤ 32 chars each).",
        400
      );
    }

    updates.tags = tags;

    if (JSON.stringify(tags) !== JSON.stringify(existing.tags)) changed.push("tags");
  }

  if ("published_at" in body && body.published_at !== null) {
    const publishedAt = parsePublishedAtInput(body.published_at);

    if (publishedAt === null) {
      return apiError("INVALID_DATE", "published_at must be an ISO 8601 datetime.", 400);
    }

    updates.published_at = publishedAt;

    if (publishedAt !== existing.published_at) changed.push("published_at");
  }

  let action: PostAction = "updated";

  if ("status" in body) {
    if (body.status !== "draft" && body.status !== "published") {
      return apiError("INVALID_BODY", "status must be 'draft' or 'published'.", 400);
    }

    if (body.status !== existing.status) {
      updates.status = body.status;
      changed.push("status");

      if (body.status === "published") {
        const effectiveExcerpt = updates.excerpt ?? existing.excerpt;

        if (!effectiveExcerpt) {
          return apiError(
            "EXCERPT_REQUIRED",
            "A non-empty excerpt is required to publish.",
            400
          );
        }

        // Preservation rule: explicit value > existing value > now.
        updates.published_at =
          updates.published_at ?? existing.published_at ?? new Date().toISOString();
        action = "published";
      } else {
        // Unpublish keeps published_at — never nulled.
        action = "unpublished";
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return apiError("INVALID_BODY", "No updatable fields were provided.", 400);
  }

  const actorKind = actor.kind === "admin" ? ("admin" as const) : ("agent" as const);

  updates.updated_by = actorKind;
  updates.updated_by_token_id = actor.kind === "agent" ? actor.tokenId : null;

  try {
    const post = await db.transaction(async (tx) => {
      const [saved] = (await tx
        .update(blogPosts)
        .set(updates)
        .where(
          ifUpdatedAt !== undefined
            ? and(eq(blogPosts.id, id), eq(blogPosts.updated_at, ifUpdatedAt))
            : eq(blogPosts.id, id)
        )
        .returning()) as BlogPost[];

      // The pre-transaction if_updated_at check already rejected an obvious
      // mismatch, but it read `existing` before this transaction opened — a
      // second writer can commit in between. The WHERE above is the atomic
      // guard: if it matched zero rows, someone else's write landed first.
      // Throwing here rolls back the transaction, so no event row is written
      // for a lost race.
      if (!saved) {
        throw new PatchConflictError();
      }

      // A PATCH that changed nothing observable (e.g. autosave resending the
      // same text) bumps updated_at but earns no log row — the activity log
      // records changes, not keystrokes.
      if (action !== "updated" || changed.length > 0) {
        await recordPostEvent(tx, {
          postId: saved.id,
          postTitle: saved.title,
          actor: actorKind,
          tokenId: actor.kind === "agent" ? actor.tokenId : null,
          action,
          summary: changed.join(", "),
        });
      }

      return saved;
    });

    revalidateBlog();

    return NextResponse.json(post, { status: 200 });
  } catch (error) {
    if (error instanceof PatchConflictError) {
      return apiError(
        "CONFLICT",
        "This post changed since you loaded it — reload and retry.",
        409
      );
    }

    if (postgresErrorCode(error) === UNIQUE_VIOLATION) {
      return apiError("SLUG_TAKEN", "A post with that slug already exists.", 409);
    }

    logQueryError("Post update error:", error);
    return apiError("SERVER_ERROR", "Could not update the post.", 500);
  }
}

/**
 * DELETE /api/blog/posts/[id] — hard delete. The 'deleted' event is written
 * BEFORE the row goes (same transaction); the FK's on-delete-set-null then
 * detaches it, so history survives with the title snapshot.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireBlogAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { actor, db } = authResult;
  const { id } = await params;

  if (!isUuid(id)) {
    return apiError("NOT_FOUND", "No post with that id.", 404);
  }

  const actorKind = actor.kind === "admin" ? ("admin" as const) : ("agent" as const);

  try {
    const existing = await loadPost(db, id);

    if (!existing) {
      return apiError("NOT_FOUND", "No post with that id.", 404);
    }

    await db.transaction(async (tx) => {
      await recordPostEvent(tx, {
        postId: existing.id,
        postTitle: existing.title,
        actor: actorKind,
        tokenId: actor.kind === "agent" ? actor.tokenId : null,
        action: "deleted",
      });

      await tx.delete(blogPosts).where(eq(blogPosts.id, id));
    });

    revalidateBlog();

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    logQueryError("Post delete error:", error);
    return apiError("SERVER_ERROR", "Could not delete the post.", 500);
  }
}
