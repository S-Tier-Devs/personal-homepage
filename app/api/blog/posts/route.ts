import { and, desc, eq, sql } from "drizzle-orm";
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
  slugFromTitle,
} from "@/lib/blog/posts";
import { revalidateBlog } from "@/lib/blog/revalidate";
import type { BlogPost, BlogPostListItem, PostStatus } from "@/lib/blog/types";
import {
  UNIQUE_VIOLATION,
  apiError,
  logQueryError,
  postgresErrorCode,
  readJsonObject,
} from "@/lib/dashboard/api";
import { blogPosts } from "@/lib/db/schema";
import { getSpacesMediaCdnUrl } from "@/lib/env";
import { POST_CONTENT_MAX_LENGTH, sanitizePostHtml } from "@/lib/sanitize";

/** List payloads omit content_html (spec → Admin API). */
const LIST_FIELDS = {
  id: blogPosts.id,
  slug: blogPosts.slug,
  title: blogPosts.title,
  excerpt: blogPosts.excerpt,
  status: blogPosts.status,
  published_at: blogPosts.published_at,
  tags: blogPosts.tags,
  reading_minutes: blogPosts.reading_minutes,
  created_by: blogPosts.created_by,
  updated_by: blogPosts.updated_by,
  created_by_token_id: blogPosts.created_by_token_id,
  updated_by_token_id: blogPosts.updated_by_token_id,
  created_at: blogPosts.created_at,
  updated_at: blogPosts.updated_at,
};

/**
 * GET /api/blog/posts — all posts, updated_at desc. `?status=` filters are
 * DERIVED: published = live (published_at <= now), scheduled = published with
 * a future date; there is no 'scheduled' column value.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireBlogAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;
  const statusParam = request.nextUrl.searchParams.get("status");

  if (statusParam !== null && !["draft", "published", "scheduled"].includes(statusParam)) {
    return apiError("INVALID_BODY", "status must be draft, published, or scheduled.", 400);
  }

  const filter =
    statusParam === "draft"
      ? eq(blogPosts.status, "draft")
      : statusParam === "published"
        ? and(eq(blogPosts.status, "published"), sql`${blogPosts.published_at} <= now()`)
        : statusParam === "scheduled"
          ? and(eq(blogPosts.status, "published"), sql`${blogPosts.published_at} > now()`)
          : undefined;

  try {
    const posts = (await db
      .select(LIST_FIELDS)
      .from(blogPosts)
      .where(filter)
      .orderBy(desc(blogPosts.updated_at))) as BlogPostListItem[];

    return NextResponse.json({ posts }, { status: 200 });
  } catch (error) {
    logQueryError("Post list error:", error);
    return apiError("SERVER_ERROR", "Could not load posts.", 500);
  }
}

/**
 * POST /api/blog/posts — create. Validation order: cheap shape checks, then
 * slug, tags, date, publish rules; content is sanitised server-side (the
 * client is never the only sanitiser). 23505 on slug → SLUG_TAKEN 409.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireBlogAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { actor, db } = authResult;
  const body = await readJsonObject(request);

  if (!body) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";

  if (!title) {
    return apiError("INVALID_BODY", "title is required.", 400);
  }

  if (title.length > POST_TITLE_MAX_LENGTH) {
    return apiError("INVALID_TITLE", `title must be ≤ ${POST_TITLE_MAX_LENGTH} chars.`, 400);
  }

  let slug: string;

  if (body.slug !== undefined) {
    if (typeof body.slug !== "string" || !isValidSlug(body.slug)) {
      return apiError(
        "INVALID_SLUG",
        "slug must be lowercase letters/digits with single hyphens, ≤ 100 chars.",
        400
      );
    }

    slug = body.slug;
  } else {
    slug = slugFromTitle(title);

    if (!slug) {
      return apiError(
        "INVALID_SLUG",
        "The title yields no usable slug — provide one explicitly.",
        400
      );
    }
  }

  const excerpt = typeof body.excerpt === "string" ? body.excerpt.trim() : "";

  if (excerpt.length > POST_EXCERPT_MAX_LENGTH) {
    return apiError("INVALID_BODY", `excerpt must be ≤ ${POST_EXCERPT_MAX_LENGTH} chars.`, 400);
  }

  const rawContent = typeof body.content_html === "string" ? body.content_html : "";

  if (rawContent.length > POST_CONTENT_MAX_LENGTH) {
    return apiError("INVALID_CONTENT", "content_html is too large.", 400);
  }

  const tags = body.tags === undefined ? [] : normalizeTags(body.tags);

  if (tags === null) {
    return apiError(
      "INVALID_TAGS",
      "tags must be ≤ 8 strings of lowercase letters, digits, hyphens (≤ 32 chars each).",
      400
    );
  }

  const status: PostStatus = body.status === "published" ? "published" : "draft";

  if (body.status !== undefined && body.status !== "draft" && body.status !== "published") {
    return apiError("INVALID_BODY", "status must be 'draft' or 'published'.", 400);
  }

  let publishedAt: string | null = null;

  if (body.published_at !== undefined && body.published_at !== null) {
    publishedAt = parsePublishedAtInput(body.published_at);

    if (publishedAt === null) {
      return apiError("INVALID_DATE", "published_at must be an ISO 8601 datetime.", 400);
    }
  }

  if (status === "published") {
    if (!excerpt) {
      return apiError("EXCERPT_REQUIRED", "A non-empty excerpt is required to publish.", 400);
    }

    publishedAt = publishedAt ?? new Date().toISOString();
  }

  const contentHtml = sanitizePostHtml(rawContent, { mediaOrigin: getSpacesMediaCdnUrl() });
  const actorKind = actor.kind === "admin" ? ("admin" as const) : ("agent" as const);
  const tokenId = actor.kind === "agent" ? actor.tokenId : null;

  try {
    const post = await db.transaction(async (tx) => {
      const [created] = (await tx
        .insert(blogPosts)
        .values({
          slug,
          title,
          excerpt,
          content_html: contentHtml,
          status,
          published_at: publishedAt,
          tags,
          reading_minutes: readingMinutes(contentHtml),
          created_by: actorKind,
          updated_by: actorKind,
          created_by_token_id: tokenId,
          updated_by_token_id: tokenId,
        })
        .returning()) as BlogPost[];

      await recordPostEvent(tx, {
        postId: created.id,
        postTitle: created.title,
        actor: actorKind,
        tokenId,
        action: "created",
      });

      if (created.status === "published") {
        await recordPostEvent(tx, {
          postId: created.id,
          postTitle: created.title,
          actor: actorKind,
          tokenId,
          action: "published",
          summary: isLive(created) ? "" : "scheduled",
        });
      }

      return created;
    });

    revalidateBlog();

    return NextResponse.json(post, { status: 201 });
  } catch (error) {
    if (postgresErrorCode(error) === UNIQUE_VIOLATION) {
      return apiError("SLUG_TAKEN", "A post with that slug already exists.", 409);
    }

    logQueryError("Post create error:", error);
    return apiError("SERVER_ERROR", "Could not create the post.", 500);
  }
}
