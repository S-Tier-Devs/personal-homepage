import { and, desc, eq, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { slugFromTitle } from "@/lib/blog/posts";
import { BLOG_CACHE_TAG } from "@/lib/blog/revalidate";
import type { BlogPost } from "@/lib/blog/types";
import { getDb } from "@/lib/db/client";
import { blogPosts } from "@/lib/db/schema";
import { noteHtmlToText } from "@/lib/sanitize";

/**
 * THE public read: every live post, newest first, full rows (the index, slug
 * pages, RSS and sitemap all carve from this one cache entry). Cached under
 * the "blog" tag with a 300s revalidate — the only two invalidation paths are
 * time (how scheduled posts go live with no cron) and revalidateBlog() on
 * mutation. Pages calling this must be dynamic (`force-dynamic`): the classic
 * static model would run this query at BUILD time, where DATABASE_URL does
 * not exist on App Platform (RUN_TIME-scoped — see docs/ARCHITECTURE.md).
 */
const readLivePosts = unstable_cache(
  async (): Promise<BlogPost[]> => {
    const db = getDb();

    return (await db
      .select()
      .from(blogPosts)
      .where(
        and(eq(blogPosts.status, "published"), sql`${blogPosts.published_at} <= now()`)
      )
      .orderBy(desc(blogPosts.published_at))) as BlogPost[];
  },
  ["blog-live-posts"],
  { tags: [BLOG_CACHE_TAG], revalidate: 300 }
);

export function getLivePosts(): Promise<BlogPost[]> {
  return readLivePosts();
}

export async function getLivePost(slug: string): Promise<BlogPost | null> {
  return (await readLivePosts()).find((post) => post.slug === slug) ?? null;
}

export async function getPostNeighbors(
  slug: string
): Promise<{ newer: BlogPost | null; older: BlogPost | null }> {
  const posts = await readLivePosts();
  const index = posts.findIndex((post) => post.slug === slug);

  if (index === -1) {
    return { newer: null, older: null };
  }

  // posts is newest-first.
  return { newer: posts[index - 1] ?? null, older: posts[index + 1] ?? null };
}

/**
 * Anchor ids for h2/h3, added at RENDER time so the stored HTML stays
 * canonical (spec §HTML). The regex is safe HERE and only here: this runs on
 * sanitizePostHtml output, where headings are guaranteed attribute-free and
 * balanced — the conditions the sanitiser's own docs say a naive regex needs.
 */
export function addHeadingIds(html: string): string {
  const seen = new Map<string, number>();

  return html.replace(/<(h[23])>([\s\S]*?)<\/\1>/g, (whole, tag: string, inner: string) => {
    const base = slugFromTitle(noteHtmlToText(inner));

    if (!base) {
      return whole;
    }

    const count = (seen.get(base) ?? 0) + 1;

    seen.set(base, count);

    const id = count === 1 ? base : `${base}-${count}`;

    return `<${tag} id="${id}">${inner}</${tag}>`;
  });
}

/**
 * RSS carries full HTML, and a feed reader has no origin to resolve "/x"
 * against — root-relative hrefs must become absolute (spec §Public pages).
 * Sanitised output guarantees root-relative hrefs start with exactly one "/",
 * double-quoted, so the replace cannot touch absolute URLs.
 */
export function rewriteRelativeHrefs(html: string, origin: string): string {
  const base = origin.replace(/\/+$/, "");

  return html.replace(/href="\//g, `href="${base}/`);
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
