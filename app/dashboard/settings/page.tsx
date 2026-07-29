import { asc } from "drizzle-orm";
import type { Metadata } from "next";

import GsdKeyCard from "@/components/dashboard/settings/gsd-key-card";
import SettingsView from "@/components/dashboard/settings/settings-view";
import type { Category, GsdKeyStatus } from "@/lib/dashboard/types";
import { getDb } from "@/lib/db/client";
import { dashboardCategories, gsdConfig } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * The wire shape for a category. See app/api/categories/route.ts for why this
 * has to be named explicitly rather than selecting every column: the table
 * has a `created_at` column the `Category` contract never exposed.
 */
const CATEGORY_FIELDS = {
  id: dashboardCategories.id,
  ctx: dashboardCategories.ctx,
  kind: dashboardCategories.kind,
  name: dashboardCategories.name,
  sort_order: dashboardCategories.sort_order,
};

/** Status only — key_last4/updated_at. The api_key column is never read for display. */
const KEY_STATUS_FIELDS = {
  key_last4: gsdConfig.key_last4,
  updated_at: gsdConfig.updated_at,
};

export default async function SettingsPage() {
  // The dashboard layout has already established that the caller is the admin.
  const db = getDb();

  // Unlike Links and Notes, this page never filters by workspace: the design
  // renders a Work card and a Home card side by side, so the whole table is the
  // payload rather than a per-workspace slice.
  //
  // drizzle-orm's QueryPromise is a lazy thenable — nothing runs until
  // `.then()`/`await`, so building both query objects up front does not start
  // them. `Promise.allSettled` is what actually fires both in the same tick
  // *and* lets each be handled on its own terms: a failed key-status read is
  // non-fatal (the card starts as "not connected"), but a failed category
  // read is fatal, which a bare `Promise.all` could not distinguish once a
  // Drizzle query throws instead of returning a Supabase-style `{ error }`.
  const categoriesPromise = db
    .select(CATEGORY_FIELDS)
    .from(dashboardCategories)
    .orderBy(
      asc(dashboardCategories.ctx),
      asc(dashboardCategories.kind),
      asc(dashboardCategories.sort_order)
    );
  const keyRowsPromise = db.select(KEY_STATUS_FIELDS).from(gsdConfig).limit(1);

  const [categoriesResult, keyRowsResult] = await Promise.allSettled([
    categoriesPromise,
    keyRowsPromise,
  ]);

  if (categoriesResult.status === "rejected") {
    console.error("Settings page load error:", categoriesResult.reason);

    return (
      <section className="rounded-2xl border border-border bg-surface p-5 shadow">
        <h2 className="font-heading text-[17px] font-semibold">Categories &amp; Types</h2>
        <p className="mt-2 text-sm text-text-2">
          Categories could not be loaded. Reload the page — if it keeps failing, the dashboard
          tables are unavailable.
        </p>
      </section>
    );
  }

  const categories = categoriesResult.value as Category[];

  let keyRows: Awaited<typeof keyRowsPromise> = [];

  if (keyRowsResult.status === "fulfilled") {
    keyRows = keyRowsResult.value;
  } else {
    console.error("Settings GSD key status error:", keyRowsResult.reason);
  }

  const keyStatus: GsdKeyStatus = {
    configured: keyRows.length > 0,
    last4: keyRows[0]?.key_last4 ?? null,
    updated_at: keyRows[0]?.updated_at ?? null,
  };

  return (
    <>
      <SettingsView initialCategories={categories} />
      <GsdKeyCard initialStatus={keyStatus} />
    </>
  );
}
