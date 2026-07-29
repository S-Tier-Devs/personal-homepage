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
