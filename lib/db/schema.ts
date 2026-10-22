import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Phase 1 schema — six tables carried from Supabase, byte-compatible shapes.
 * timestamptz columns are read back as ISO strings (driver parser in
 * client.ts), matching what PostgREST returned, so the wire format and every
 * formatDate call site are unchanged.
 *
 * updated_at is maintained by $onUpdate (app-level), replacing the old
 * set_updated_at trigger.
 */

const utcNow = sql`timezone('utc'::text, now())`;

export const dashboardCategories = pgTable(
  "dashboard_categories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    ctx: text("ctx").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    sort_order: integer("sort_order").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow),
  },
  (t) => [
    check("dashboard_categories_ctx_check", sql`${t.ctx} in ('work', 'home')`),
    check("dashboard_categories_kind_check", sql`${t.kind} in ('link', 'note')`),
    // Concurrency backstop the category routes' 23505 → 409 net depends on
    // (lib/dashboard/api.ts UNIQUE_VIOLATION). Carried verbatim from Supabase:
    // UNIQUE (ctx, kind, name), constraint dashboard_categories_ctx_kind_name_key.
    unique("dashboard_categories_ctx_kind_name_key").on(t.ctx, t.kind, t.name),
    // btree (ctx, kind, sort_order), carried verbatim from Supabase.
    index("dashboard_categories_ctx_kind_sort_idx").on(t.ctx, t.kind, t.sort_order),
  ]
);

export const dashboardLinks = pgTable(
  "dashboard_links",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    ctx: text("ctx").notNull(),
    category_id: uuid("category_id")
      .notNull()
      .references(() => dashboardCategories.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    description: text("description"),
    sort_order: integer("sort_order").notNull().default(0),
    pinned: boolean("pinned").notNull().default(false),
    click_count: integer("click_count").notNull().default(0),
    last_clicked_at: timestamp("last_clicked_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow)
      .$onUpdate(() => sql`timezone('utc'::text, now())`),
  },
  (t) => [
    check("dashboard_links_ctx_check", sql`${t.ctx} in ('work', 'home')`),
    // All four secondary indexes carried verbatim from Supabase.
    index("dashboard_links_ctx_category_idx").on(t.ctx, t.category_id),
    // .nullsFirst() is Postgres's own default for DESC — spelled out because
    // drizzle-kit otherwise emits NULLS LAST, diverging from the Supabase def.
    index("dashboard_links_ctx_clicks_idx").on(t.ctx, t.click_count.desc().nullsFirst()),
    index("dashboard_links_ctx_pinned_sort_idx").on(t.ctx, t.pinned, t.sort_order),
    index("dashboard_links_ctx_sort_idx").on(t.ctx, t.sort_order),
  ]
);

export const dashboardNotes = pgTable(
  "dashboard_notes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    ctx: text("ctx").notNull(),
    category_id: uuid("category_id")
      .notNull()
      .references(() => dashboardCategories.id, { onDelete: "restrict" }),
    title: text("title").notNull().default(""),
    content_html: text("content_html").notNull().default(""),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow)
      .$onUpdate(() => sql`timezone('utc'::text, now())`),
  },
  (t) => [
    check("dashboard_notes_ctx_check", sql`${t.ctx} in ('work', 'home')`),
    // btree (ctx, updated_at DESC), carried verbatim from Supabase.
    // .nullsFirst() = Postgres's DESC default; see dashboard_links_ctx_clicks_idx.
    index("dashboard_notes_ctx_updated_idx").on(t.ctx, t.updated_at.desc().nullsFirst()),
  ]
);

export const filesMetadata = pgTable(
  "files_metadata",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    storage_path: text("storage_path").notNull().unique(),
    file_name: text("file_name").notNull(),
    mime_type: text("mime_type").notNull(),
    file_extension: text("file_extension").notNull(),
    file_size_bytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    description: text("description"),
    visibility: text("visibility").notNull().default("private"),
    // Kept as a bare uuid: the auth.users FK cannot exist here (auth stays in
    // Supabase until Phase 3). Stores the Supabase auth user id this phase.
    uploaded_by: uuid("uploaded_by"),
    last_downloaded_at: timestamp("last_downloaded_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow)
      .$onUpdate(() => sql`timezone('utc'::text, now())`),
  },
  (t) => [
    check("files_metadata_visibility_check", sql`${t.visibility} in ('private', 'public')`),
    // btree (visibility, created_at DESC), carried verbatim from Supabase.
    // .nullsFirst() = Postgres's DESC default; see dashboard_links_ctx_clicks_idx.
    index("files_metadata_visibility_idx").on(t.visibility, t.created_at.desc().nullsFirst()),
  ]
);

export const gsdConfig = pgTable(
  "gsd_config",
  {
    id: smallint("id").primaryKey().default(1),
    api_key: text("api_key").notNull(),
    key_last4: text("key_last4").notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [check("gsd_config_id_check", sql`${t.id} = 1`)]
);

/** Carried for the 12-month retention policy only; no code reads it. */
export const contactSubmissions = pgTable(
  "contact_submissions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    email: text("email").notNull(),
    subject: text("subject"),
    message: text("message").notNull(),
    status: text("status").notNull().default("unread"),
    handled_by: uuid("handled_by"),
    handled_at: timestamp("handled_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow),
  },
  (t) => [
    check(
      "contact_submissions_status_check",
      sql`${t.status} in ('unread', 'in_progress', 'resolved', 'archived')`
    ),
    // btree (status, created_at DESC), carried verbatim from Supabase.
    // .nullsFirst() = Postgres's DESC default; see dashboard_links_ctx_clicks_idx.
    index("contact_submissions_status_idx").on(t.status, t.created_at.desc().nullsFirst()),
  ]
);

/**
 * F-013 blog tables (spec docs/superpowers/specs/2026-10-22-blog-design.md).
 * api_tokens first: blog_posts carries FKs into it.
 */

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  /** SHA-256 hex of the full token. 256-bit random tokens need no slow hash. */
  token_hash: text("token_hash").notNull().unique(),
  /** First 12 chars ("pbk_" + 8), the only part ever displayed or logged. */
  token_prefix: text("token_prefix").notNull(),
  scopes: text("scopes").array().notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .default(utcNow),
  /** Updated at most once per minute per token (requireBlogAuth throttles). */
  last_used_at: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
  /** Soft revocation so blog_post_events keeps a resolvable reference. */
  revoked_at: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
});

export const blogPosts = pgTable(
  "blog_posts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull().default(""),
    /** Always sanitizePostHtml output — routes enforce it, nothing else writes. */
    content_html: text("content_html").notNull().default(""),
    status: text("status").notNull().default("draft"),
    /** Survives unpublish (never nulled); "scheduled" = published + future. */
    published_at: timestamp("published_at", { withTimezone: true, mode: "string" }),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    reading_minutes: integer("reading_minutes").notNull().default(1),
    created_by: text("created_by").notNull(),
    updated_by: text("updated_by").notNull(),
    created_by_token_id: uuid("created_by_token_id").references(() => apiTokens.id, {
      onDelete: "set null",
    }),
    updated_by_token_id: uuid("updated_by_token_id").references(() => apiTokens.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow)
      .$onUpdate(() => sql`timezone('utc'::text, now())`),
  },
  (t) => [
    check("blog_posts_status_check", sql`${t.status} in ('draft', 'published')`),
    check(
      "blog_posts_published_at_check",
      sql`${t.status} <> 'published' or ${t.published_at} is not null`
    ),
    check("blog_posts_created_by_check", sql`${t.created_by} in ('admin', 'agent')`),
    check("blog_posts_updated_by_check", sql`${t.updated_by} in ('admin', 'agent')`),
    // Serves the public "live posts" query. .nullsFirst() = Postgres's DESC
    // default; see dashboard_links_ctx_clicks_idx.
    index("blog_posts_status_published_idx").on(
      t.status,
      t.published_at.desc().nullsFirst()
    ),
  ]
);

export const blogPostEvents = pgTable(
  "blog_post_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** set null on post delete — history must survive deletion. */
    post_id: uuid("post_id").references(() => blogPosts.id, { onDelete: "set null" }),
    /** Snapshot, so a deleted post's events stay readable. */
    post_title: text("post_title").notNull(),
    actor: text("actor").notNull(),
    token_id: uuid("token_id").references(() => apiTokens.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    /** Changed field names only — never values (logQueryError spirit). */
    summary: text("summary").notNull().default(""),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow),
  },
  (t) => [
    check("blog_post_events_actor_check", sql`${t.actor} in ('admin', 'agent')`),
    check(
      "blog_post_events_action_check",
      sql`${t.action} in ('created', 'updated', 'published', 'unpublished', 'deleted')`
    ),
    index("blog_post_events_post_idx").on(t.post_id, t.created_at.desc().nullsFirst()),
  ]
);
