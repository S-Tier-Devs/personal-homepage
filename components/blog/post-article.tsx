import type { BlogPost } from "@/lib/blog/types";
import { addHeadingIds } from "@/lib/blog/public";

function formatDate(iso: string | null): string {
  if (!iso) return "";

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * The public article template (also rendered by the admin preview route).
 * Server component; the body is sanitizePostHtml output, which is the one
 * precondition that makes dangerouslySetInnerHTML acceptable here.
 */
export default function PostArticle({
  post,
  newer,
  older,
}: {
  post: BlogPost;
  newer?: Pick<BlogPost, "slug" | "title"> | null;
  older?: Pick<BlogPost, "slug" | "title"> | null;
}) {
  const updatedAfterPublish =
    post.published_at !== null &&
    new Date(post.updated_at).getTime() - new Date(post.published_at).getTime() > 60_000;

  return (
    <article>
      <header>
        {post.tags.length > 0 && (
          <p className="flex flex-wrap gap-1.5">
            {/* Plain chips — tag archive routes are backlogged, not linked. */}
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-[20px] border border-border bg-surface-2 px-[9px] py-[2px] font-mono text-[11px] text-text-2"
              >
                {tag}
              </span>
            ))}
          </p>
        )}
        <h1 className="mt-3 font-heading text-[2rem] font-bold leading-[1.2] tracking-[-0.01em]">
          {post.title}
        </h1>
        {post.excerpt && <p className="mt-3 text-[17px] leading-[1.6] text-text-2">{post.excerpt}</p>}
        <p className="mt-4 font-mono text-xs text-muted">
          {formatDate(post.published_at)}
          {updatedAfterPublish && <> · updated {formatDate(post.updated_at)}</>}
          {" · "}
          {post.reading_minutes} min read
        </p>
      </header>

      <div
        className="post-body mt-8 text-[16px] leading-[1.75]"
        dangerouslySetInnerHTML={{ __html: addHeadingIds(post.content_html) }}
      />

      {(newer || older) && (
        <nav aria-label="More posts" className="mt-12 flex justify-between gap-4 border-t border-border pt-6 text-sm">
          <span className="min-w-0">
            {older && (
              <a href={`/blog/${older.slug}`} className="font-semibold">
                ← {older.title}
              </a>
            )}
          </span>
          <span className="min-w-0 text-right">
            {newer && (
              <a href={`/blog/${newer.slug}`} className="font-semibold">
                {newer.title} →
              </a>
            )}
          </span>
        </nav>
      )}
    </article>
  );
}
