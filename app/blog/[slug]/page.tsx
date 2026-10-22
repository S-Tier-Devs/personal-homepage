import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PostArticle from "@/components/blog/post-article";
import { getLivePost, getPostNeighbors } from "@/lib/blog/public";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getLivePost(slug);

  if (!post) {
    return {};
  }

  const url = `${getSiteUrl()}/blog/${post.slug}`;

  return {
    title: `${post.title} — Patrick Beasley`,
    description: post.excerpt || undefined,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt || undefined,
      url,
      publishedTime: post.published_at ?? undefined,
      modifiedTime: post.updated_at,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getLivePost(slug);

  // Drafts and scheduled posts are indistinguishable from nonexistent ones.
  if (!post) notFound();

  const { newer, older } = await getPostNeighbors(slug);

  return <PostArticle post={post} newer={newer} older={older} />;
}
