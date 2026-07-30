/**
 * Shared dashboard entity types. Single source of truth for both server code
 * (route handlers, server components) and client views — later sections
 * (Notes, Documents, Settings) add their own rows here rather than redeclaring
 * shapes next to the components that render them.
 *
 * Field names mirror the columns in
 * supabase/migrations/202607210001_dashboard_schema.sql verbatim, so a row read
 * from Supabase is already a valid entity with no mapping layer in between.
 */

/** Workspace a row belongs to. Matches the `ctx` check constraint. */
export type Ctx = "work" | "home";

/** Which section a category belongs to. Matches the `kind` check constraint. */
export type CategoryKind = "link" | "note";

export function isCtx(value: unknown): value is Ctx {
  return value === "work" || value === "home";
}

export function isCategoryKind(value: unknown): value is CategoryKind {
  return value === "link" || value === "note";
}

export interface Category {
  id: string;
  ctx: Ctx;
  kind: CategoryKind;
  name: string;
  sort_order: number;
}

export interface LinkItem {
  id: string;
  ctx: Ctx;
  category_id: string;
  title: string;
  url: string;
  description: string | null;
  sort_order: number;
  /**
   * Pinned links render in a band above every other link in the workspace,
   * independently of the active sort.
   */
  pinned: boolean;
  created_at: string;
  updated_at: string;
  /** All-time click count, incremented by the click beacon. */
  click_count: number;
  /** When the link was last clicked; null if never. */
  last_clicked_at: string | null;
}

/**
 * A note. Unlike a link, `title` may legitimately be empty — the editor creates
 * the row before anything is typed into it, and the UI renders "Untitled" for
 * the empty case. `content_html` always holds *sanitized* markup: the API runs
 * `sanitizeNoteHtml` on every write, so nothing else in the app has to.
 *
 * `updated_at` is maintained by the `dashboard_notes_set_updated_at` trigger and
 * must never be written from application code; the "Recent" sort reads it.
 */
export interface NoteItem {
  id: string;
  ctx: Ctx;
  category_id: string;
  title: string;
  content_html: string;
  created_at: string;
  updated_at: string;
}

/**
 * A row of `files_metadata`, as returned by `GET /api/files` and read directly
 * by the Documents page.
 *
 * Note what is absent: there is **no `ctx`**. `files_metadata` has no such
 * column and documents are not workspace-scoped — one flat list is shown
 * identically in Work and Home. Do not add workspace filtering here.
 *
 * `storage_path` and `uploaded_by` exist on the table but are not part of the
 * list contract; see `FILE_FIELDS` in app/api/files/route.ts.
 */
export interface DocumentItem {
  id: string;
  file_name: string;
  file_extension: string | null;
  mime_type: string | null;
  file_size_bytes: number;
  description: string | null;
  visibility: "private" | "public";
  created_at: string;
}

/**
 * Status of the stored Project-GSD API key, as returned by /api/gsd-key.
 * Deliberately never includes the key itself: `last4` is computed server-side
 * at save time and is the only key-derived value that reaches a browser.
 */
export interface GsdKeyStatus {
  configured: boolean;
  last4: string | null;
  updated_at: string | null;
}
