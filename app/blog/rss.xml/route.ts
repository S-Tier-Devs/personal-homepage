import { NextResponse } from "next/server";

import { escapeXml, getLivePosts, rewriteRelativeHrefs } from "@/lib/blog/public";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/** RSS 2.0, latest 20 live posts, full sanitised HTML (hrefs absolutised). */
export async function GET() {
  const site = getSiteUrl();
  const posts = (await getLivePosts()).slice(0, 20);

  const items = posts
    .map((post) => {
      const url = `${site}/blog/${post.slug}`;

      return [
        "<item>",
        `<title>${escapeXml(post.title)}</title>`,
        `<link>${url}</link>`,
        `<guid isPermaLink="true">${url}</guid>`,
        `<pubDate>${new Date(post.published_at ?? post.created_at).toUTCString()}</pubDate>`,
        ...post.tags.map((tag) => `<category>${escapeXml(tag)}</category>`),
        `<description>${escapeXml(rewriteRelativeHrefs(post.content_html, site))}</description>`,
        "</item>",
      ].join("");
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Patrick Beasley — Blog</title>
<link>${site}/blog</link>
<description>Writing on software, infrastructure, and building in public.</description>
<language>en</language>
${items}
</channel>
</rss>`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
