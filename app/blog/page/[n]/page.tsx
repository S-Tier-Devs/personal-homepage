import type { Metadata } from "next";
import { notFound } from "next/navigation";

import BlogIndex, { BLOG_PAGE_SIZE } from "@/components/blog/blog-index";
import { getLivePosts } from "@/lib/blog/public";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ n: string }>;
}): Promise<Metadata> {
  const { n } = await params;

  return {
    title: `Blog — page ${n} — Patrick Beasley`,
    alternates: { canonical: `${getSiteUrl()}/blog/page/${n}` },
  };
}

export default async function BlogPagePage({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;

  // Page 1 lives at /blog; only integer pages ≥ 2 exist here.
  if (!/^\d+$/.test(n)) notFound();

  const page = Number(n);

  if (page < 2) notFound();

  const posts = await getLivePosts();
  const totalPages = Math.max(1, Math.ceil(posts.length / BLOG_PAGE_SIZE));

  if (page > totalPages) notFound();

  const start = (page - 1) * BLOG_PAGE_SIZE;

  return (
    <BlogIndex posts={posts.slice(start, start + BLOG_PAGE_SIZE)} page={page} totalPages={totalPages} />
  );
}
