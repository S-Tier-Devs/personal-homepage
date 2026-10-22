import { desc } from "drizzle-orm";
import type { Metadata } from "next";

import BlogView from "@/components/dashboard/blog/blog-view";
import type { BlogPost } from "@/lib/blog/types";
import { getDb } from "@/lib/db/client";
import { blogPosts } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Blog",
};

export default async function BlogPage() {
  // The dashboard layout has already established that the caller is the admin.
  const db = getDb();

  let posts: BlogPost[];

  try {
    // Blog is NOT workspace-scoped (like Documents and Settings) — whole table.
    posts = (await db
      .select()
      .from(blogPosts)
      .orderBy(desc(blogPosts.updated_at))) as BlogPost[];
  } catch (error) {
    console.error("Blog page load error:", error);

    return (
      <section className="rounded-2xl border border-border bg-surface p-5 shadow">
        <h2 className="font-heading text-[17px] font-semibold">Blog</h2>
        <p className="mt-2 text-sm text-text-2">
          Posts could not be loaded. Reload the page — if it keeps failing, the blog
          tables are unavailable.
        </p>
      </section>
    );
  }

  return <BlogView initialPosts={posts} />;
}
