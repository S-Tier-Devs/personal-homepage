/**
 * Blog entity types (F-013). Field names mirror lib/db/schema.ts columns
 * verbatim, same policy as lib/dashboard/types.ts. The blog is NOT
 * workspace-scoped — there is deliberately no `ctx` anywhere here.
 */

export type PostStatus = "draft" | "published";
export type PostActor = "admin" | "agent";
export type PostAction = "created" | "updated" | "published" | "unpublished" | "deleted";

/** Admin-facing derived display status. "published" here means LIVE. */
export type DerivedStatus = "draft" | "published" | "scheduled";

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  /** Always sanitizePostHtml output. */
  content_html: string;
  status: PostStatus;
  published_at: string | null;
  tags: string[];
  reading_minutes: number;
  created_by: PostActor;
  updated_by: PostActor;
  created_by_token_id: string | null;
  updated_by_token_id: string | null;
  created_at: string;
  updated_at: string;
}

/** List responses omit the body. */
export type BlogPostListItem = Omit<BlogPost, "content_html">;

export interface BlogPostEvent {
  id: string;
  post_id: string | null;
  post_title: string;
  actor: PostActor;
  token_id: string | null;
  action: PostAction;
  summary: string;
  created_at: string;
}

/** Token metadata — NEVER includes token_hash or the token value. */
export interface ApiTokenMeta {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
