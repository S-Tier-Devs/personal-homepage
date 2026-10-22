import type { BlogPost } from "@/lib/blog/types";

export const BLOG_PAGE_SIZE = 10;

function formatDate(iso: string | null): string {
  if (!iso) return "";

  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function Row({ post }: { post: BlogPost }) {
  return (
    <li className="border-b border-border py-6 last:border-b-0">
      <a href={`/blog/${post.slug}`} className="group block">
        <h3 className="font-heading text-[1.15rem] font-semibold text-text group-hover:text-accent">
          {post.title}
        </h3>
        {post.excerpt && <p className="mt-1.5 text-[14px] leading-[1.6] text-text-2">{post.excerpt}</p>}
        <p className="mt-2 font-mono text-xs text-muted">
          {formatDate(post.published_at)} · {post.reading_minutes} min read
          {post.tags.length > 0 && <> · {post.tags.join(", ")}</>}
        </p>
      </a>
    </li>
  );
}

/** Page 1 features the latest post (mockup frame 1); later pages are a plain list. */
export default function BlogIndex({
  posts,
  page,
  totalPages,
}: {
  posts: BlogPost[];
  page: number;
  totalPages: number;
}) {
  const [featured, ...rest] = page === 1 ? posts : [undefined, ...posts];

  return (
    <>
      <h1 className="font-heading text-[1.6rem] font-bold tracking-[-0.01em]">Blog</h1>

      {posts.length === 0 && (
        <p className="mt-8 text-sm text-muted">Nothing published yet — check back soon.</p>
      )}

      {featured && (
        <a
          href={`/blog/${featured.slug}`}
          className="group mt-8 block rounded-2xl border border-border bg-surface p-6 shadow"
        >
          <p className="font-mono text-[11px] uppercase tracking-wide text-accent">Latest</p>
          <h2 className="mt-2 font-heading text-[1.4rem] font-bold leading-[1.3] text-text group-hover:text-accent">
            {featured.title}
          </h2>
          {featured.excerpt && (
            <p className="mt-2 text-[15px] leading-[1.6] text-text-2">{featured.excerpt}</p>
          )}
          <p className="mt-3 font-mono text-xs text-muted">
            {formatDate(featured.published_at)} · {featured.reading_minutes} min read
          </p>
        </a>
      )}

      <ul className="mt-4 list-none">
        {rest.filter(Boolean).map((post) => (
          <Row key={(post as BlogPost).id} post={post as BlogPost} />
        ))}
      </ul>

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="mt-8 flex items-center justify-between text-sm">
          <span>
            {page > 1 && (
              <a href={page === 2 ? "/blog" : `/blog/page/${page - 1}`} className="font-semibold">
                ← Newer
              </a>
            )}
          </span>
          <span className="font-mono text-xs text-muted">
            page {page} / {totalPages}
          </span>
          <span>
            {page < totalPages && (
              <a href={`/blog/page/${page + 1}`} className="font-semibold">
                Older →
              </a>
            )}
          </span>
        </nav>
      )}
    </>
  );
}
