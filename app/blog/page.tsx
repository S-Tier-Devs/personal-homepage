import type { Metadata } from "next";

import BlogIndex, { BLOG_PAGE_SIZE } from "@/components/blog/blog-index";
import { getLivePosts } from "@/lib/blog/public";
import { getSiteUrl } from "@/lib/env";

// Dynamic + tagged cache, NOT build-time static — see lib/blog/public.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog — Patrick Beasley",
  description: "Writing on software, infrastructure, and building in public.",
  alternates: { canonical: `${getSiteUrl()}/blog` },
};

export default async function BlogIndexPage() {
  const posts = await getLivePosts();
  const totalPages = Math.max(1, Math.ceil(posts.length / BLOG_PAGE_SIZE));

  return <BlogIndex posts={posts.slice(0, BLOG_PAGE_SIZE)} page={1} totalPages={totalPages} />;
}
