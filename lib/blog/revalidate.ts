import { revalidateTag } from "next/cache";

/**
 * One tag covers every public blog surface — index, pagination, slug pages,
 * RSS, sitemap — because they all read through the single cached query in
 * lib/blog/public.ts. Mutations call this instead of enumerating paths.
 * (Plan-time deviation from the spec's revalidatePath list: DATABASE_URL is
 * RUN_TIME-only, so public pages are dynamic + unstable_cache; see the plan's
 * Global Constraints.)
 */
export const BLOG_CACHE_TAG = "blog";

/**
 * Next 16 breaking change (brief/plan predate it): `revalidateTag(tag)` is a
 * TS2554 compile error now — a required second argument picks between
 * stale-while-revalidate ("max") and immediate expiry. An admin mutation
 * needs the latter — the same immediate-blocking-revalidate semantics the
 * deprecated single-arg form had, and what the plan's revalidatePath-list
 * deviation (see BLOG_CACHE_TAG doc) assumed — so every public page serves
 * the new data on its very next request instead of one stale render first.
 */
export function revalidateBlog(): void {
  revalidateTag(BLOG_CACHE_TAG, { expire: 0 });
}
