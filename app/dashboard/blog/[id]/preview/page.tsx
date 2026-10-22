import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import PostArticle from "@/components/blog/post-article";
import { deriveStatus } from "@/lib/blog/posts";
import type { BlogPost } from "@/lib/blog/types";
import { isUuid } from "@/lib/dashboard/api";
import { getDb } from "@/lib/db/client";
import { blogPosts } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Post preview",
  robots: { index: false, follow: false },
};

export default async function PostPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!isUuid(id)) notFound();

  // The dashboard layout has already established that the caller is the admin.
  const db = getDb();
  const rows = (await db
    .select()
    .from(blogPosts)
    .where(eq(blogPosts.id, id))
    .limit(1)) as BlogPost[];
  const post = rows[0];

  if (!post) notFound();

  return (
    <section className="rounded-2xl border border-border bg-surface p-6 shadow">
      <p className="mb-6 rounded-[9px] border border-amber-600/40 bg-surface-2 px-3 py-2 font-mono text-xs text-amber-600">
        Preview — {deriveStatus(post)} · this is how the post renders publicly
      </p>
      <div className="mx-auto max-w-[720px]">
        <PostArticle post={post} />
      </div>
    </section>
  );
}
