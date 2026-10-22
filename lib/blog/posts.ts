import type { DerivedStatus } from "@/lib/blog/types";
import { noteHtmlToText } from "@/lib/sanitize";

/** Caps checked against RAW request values, before sanitising. */
export const POST_TITLE_MAX_LENGTH = 200;
export const POST_EXCERPT_MAX_LENGTH = 300;
export const POST_SLUG_MAX_LENGTH = 100;
export const POST_MAX_TAGS = 8;

const READING_WPM = 225;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_PATTERN = /^[a-z0-9-]{1,32}$/;

export function isValidSlug(value: string): boolean {
  return value.length <= POST_SLUG_MAX_LENGTH && SLUG_PATTERN.test(value);
}

/**
 * Best-effort slug from a title. May legitimately return "" (all-symbol
 * title), which the caller turns into INVALID_SLUG asking for an explicit one.
 */
export function slugFromTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, POST_SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}

/**
 * Normalises a tags payload: trim, lowercase, inner whitespace → hyphen,
 * dedupe, order preserved. Null (⇒ INVALID_TAGS) when the payload is not an
 * array of valid tags or exceeds the cap — one bad tag fails the request, so
 * an agent's typo is surfaced instead of silently dropped.
 */
export function normalizeTags(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;

  const tags: string[] = [];

  for (const value of raw) {
    if (typeof value !== "string") return null;

    const tag = value.trim().toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-");

    if (!TAG_PATTERN.test(tag)) return null;
    if (!tags.includes(tag)) tags.push(tag);
  }

  return tags.length <= POST_MAX_TAGS ? tags : null;
}

/** ≈225 wpm over the text rendering of the sanitised body, floor 1. */
export function readingMinutes(contentHtml: string): number {
  const words = noteHtmlToText(contentHtml).split(/\s+/).filter(Boolean).length;

  return Math.max(1, Math.ceil(words / READING_WPM));
}

/**
 * "Live" is the derived state the whole feature pivots on: published AND
 * published_at in the past. A published post with a future date is Scheduled
 * — same row, no cron, it becomes live by time passing (spec → data model).
 */
export function isLive(
  post: { status: string; published_at: string | null },
  now: Date = new Date()
): boolean {
  if (post.status !== "published" || post.published_at === null) return false;

  const at = new Date(post.published_at).getTime();

  return !Number.isNaN(at) && at <= now.getTime();
}

export function deriveStatus(
  post: { status: string; published_at: string | null },
  now: Date = new Date()
): DerivedStatus {
  if (post.status !== "published") return "draft";

  return isLive(post, now) ? "published" : "scheduled";
}

/** Normalises a published_at input to ISO; null when unusable (⇒ INVALID_DATE). */
export function parsePublishedAtInput(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

  const date = new Date(raw);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
