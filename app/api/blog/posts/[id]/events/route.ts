import { desc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { requireBlogAuth } from "@/lib/auth/blog-guard";
import type { BlogPostEvent } from "@/lib/blog/types";
import { apiError, isUuid, logQueryError } from "@/lib/dashboard/api";
import { blogPostEvents } from "@/lib/db/schema";

/** GET /api/blog/posts/[id]/events — the full activity log, newest first. */
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
    const events = (await db
      .select()
      .from(blogPostEvents)
      .where(eq(blogPostEvents.post_id, id))
      .orderBy(desc(blogPostEvents.created_at))) as BlogPostEvent[];

    return NextResponse.json({ events }, { status: 200 });
  } catch (error) {
    logQueryError("Post events error:", error);
    return apiError("SERVER_ERROR", "Could not load the activity log.", 500);
  }
}
