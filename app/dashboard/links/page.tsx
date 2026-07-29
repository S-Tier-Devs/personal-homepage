import { asc } from "drizzle-orm";
import type { Metadata } from "next";

import LinksView from "@/components/dashboard/links/links-view";
import type { Category, LinkItem } from "@/lib/dashboard/types";
import { getDb } from "@/lib/db/client";
import { dashboardCategories, dashboardLinks } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Links",
};

export default async function LinksPage() {
  // The dashboard layout has already established that the caller is the admin.
  const db = getDb();

  // Both workspaces come back in one pass: a single admin with a handful of
  // rows, so switching workspaces in the client is a filter, not a refetch.
  let links: LinkItem[];
  let categories: Category[];

  try {
    // Drizzle types `ctx`/`kind` as plain `text`, wider than the narrower
    // unions on LinkItem/Category; the check constraints guarantee the
    // narrower types at runtime, same cast used for the category twins in
    // lib/dashboard/api.ts.
    const [linkRows, categoryRows] = await Promise.all([
      db.select().from(dashboardLinks).orderBy(asc(dashboardLinks.sort_order)),
      db.select().from(dashboardCategories).orderBy(asc(dashboardCategories.sort_order)),
    ]);

    links = linkRows as LinkItem[];
    categories = categoryRows as Category[];
  } catch (error) {
    console.error("Links page load error:", error);

    return (
      <section className="rounded-2xl border border-border bg-surface p-5 shadow">
        <h2 className="font-heading text-[17px] font-semibold">Links</h2>
        <p className="mt-2 text-sm text-text-2">
          Links could not be loaded. Reload the page — if it keeps failing, the dashboard
          tables are unavailable.
        </p>
      </section>
    );
  }

  return <LinksView initialLinks={links} categories={categories} />;
}
