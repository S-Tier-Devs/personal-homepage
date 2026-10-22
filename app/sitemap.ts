import { MetadataRoute } from "next";

import { getLivePosts } from "@/lib/blog/public";
import { getSiteUrl } from "@/lib/env";

// DB-backed now, so it must not render at build time (DATABASE_URL is
// RUN_TIME-only on App Platform); the post list rides the "blog" cache tag.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getSiteUrl();
  const posts = await getLivePosts();

  return [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/blog`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    ...posts.map((post) => ({
      url: `${baseUrl}/blog/${post.slug}`,
      lastModified: new Date(post.updated_at),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
