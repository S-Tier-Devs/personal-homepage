import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import type { DrizzleDb } from "@/lib/db/client";
import { dashboardCategories } from "@/lib/db/schema";
import type { Category, CategoryKind, Ctx } from "@/lib/dashboard/types";

/**
 * Wire conventions shared by every dashboard API route.
 *
 * Success responses carry the entity itself (or `{ ok: true }` for deletes);
 * list endpoints carry a single named collection key, matching the established
 * `app/api/files/route.ts` idiom.
 *
 * Failures always carry `{ error: <MACHINE_CODE>, message: <human text> }` so
 * clients can branch on `error` and surface `message` verbatim in a toast.
 */
export type ApiErrorCode =
  | "INVALID_BODY"
  | "INVALID_CTX"
  | "INVALID_URL"
  | "INVALID_CATEGORY"
  // Oversize title/body are separated from INVALID_BODY on purpose: they are the
  // one validation failure a client can act on itself (trim and retry), so the
  // note editor needs to tell them apart from "you sent nonsense".
  | "INVALID_TITLE"
  | "INVALID_CONTENT"
  | "NOT_FOUND"
  | "CONFLICT"
  // Settings (app/api/categories/*). Both are 409s with a reason the user can
  // act on, which is why they are not folded into the generic CONFLICT: the
  // remedy differs (add another category first vs. move the items off this one).
  | "LAST_CATEGORY"
  | "CATEGORY_IN_USE"
  | "SERVER_ERROR"
  // Documents (app/api/files/*).
  | "INVALID_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "STORAGE_ERROR";

export function apiError(error: ApiErrorCode, message: string, status: number) {
  return NextResponse.json({ error, message }, { status });
}

/**
 * Category names are chips in a fixed-width card, and the column is unbounded
 * `text`. The cap is presentational rather than a data constraint, so it lives
 * here (and on the input's `maxLength`) rather than in the schema.
 */
export const CATEGORY_NAME_MAX_LENGTH = 40;

/**
 * SQLSTATEs the category routes have to translate into 409s instead of letting
 * them surface as 500s.
 *
 * `23505` is `unique (ctx, kind, name)` on `dashboard_categories`; `23503` is
 * the `on delete restrict` foreign key from `dashboard_links`/`dashboard_notes`.
 * Both are also checked explicitly before the write, so these only fire when a
 * concurrent request wins the race — but "never a 500" has to hold either way.
 */
export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Reads the SQLSTATE off a PostgREST *or postgres.js* error without asserting
 * its whole shape. postgres.js errors carry the same string `code` SQLSTATE
 * property PostgREST errors did, so this works unchanged for the Drizzle call
 * sites too.
 */
export function postgresErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const { code } = error as { code?: unknown };

  return typeof code === "string" ? code : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guards route params before they reach Postgres: a non-UUID id would make the
 * query fail with a 22P02 syntax error and surface as a 500, when the honest
 * answer is simply that no such row exists.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Parses a JSON request body into a plain object, or null if it is anything else. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return null;
    }

    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Normalizes a user-supplied URL the way the design does — prepending
 * `https://` when the scheme is omitted — then validates it.
 *
 * URLs stored here are rendered as `href`s, so the scheme check is the XSS
 * gate: `javascript:`, `data:` and friends must never reach the database. The
 * prepend runs first, exactly as in the design, which turns a bare
 * `javascript:alert(1)` into an unparseable authority; the explicit protocol
 * allow-list below then catches everything the prepend does not.
 *
 * Returns the normalized absolute URL, or null when it is not a usable
 * http(s) URL.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  // A URL with no host ("https://?x=1") parses but is not a link anyone can follow.
  if (!parsed.hostname) {
    return null;
  }

  return parsed.toString();
}

/**
 * Trims a user-supplied category name and confirms it is usable. Returns null
 * for anything that is not a non-empty string within the length cap, which the
 * caller turns into a single `INVALID_BODY` — the two failures share a remedy
 * (type something shorter and non-blank), so they do not need separate codes.
 */
export function normalizeCategoryName(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();

  if (!trimmed || trimmed.length > CATEGORY_NAME_MAX_LENGTH) {
    return null;
  }

  return trimmed;
}

/**
 * Every category in one `ctx`+`kind` list. POST needs it for the next
 * `sort_order`; both writes need it for the case-insensitive duplicate check
 * the design performs (design/patrick-beasley.dc.html line 608), which the
 * database's own case-*sensitive* unique constraint would otherwise let past.
 *
 * Returns null when the read itself failed, so a caller can tell an empty list
 * from a broken query rather than inventing `sort_order` 0 on an error.
 */
export async function listCategorySiblings(
  db: DrizzleDb,
  ctx: Ctx,
  kind: CategoryKind
): Promise<Category[] | null> {
  try {
    // Drizzle types `ctx`/`kind` as plain `text` columns (drizzle-kit doesn't
    // model the check constraints as enums), so the row type is wider than
    // `Category`. The database's check constraints guarantee the narrower
    // union at runtime.
    const rows = await db
      .select()
      .from(dashboardCategories)
      .where(and(eq(dashboardCategories.ctx, ctx), eq(dashboardCategories.kind, kind)));

    return rows as Category[];
  } catch (error) {
    console.error("Category siblings read error:", error);
    return null;
  }
}

/**
 * Confirms a category exists and belongs to the same workspace and section as
 * the item being written. `ctx` is denormalized onto item rows for single-table
 * filtering, so the API — not the database — owns keeping the two in step.
 */
export async function findMatchingCategory(
  db: DrizzleDb,
  categoryId: string,
  ctx: Ctx,
  kind: CategoryKind
): Promise<Category | null> {
  if (!isUuid(categoryId)) {
    return null;
  }

  try {
    const rows = await db
      .select()
      .from(dashboardCategories)
      .where(eq(dashboardCategories.id, categoryId))
      .limit(1);

    const category = rows[0];

    if (!category) {
      return null;
    }

    return category.ctx === ctx && category.kind === kind ? (category as Category) : null;
  } catch {
    return null;
  }
}
