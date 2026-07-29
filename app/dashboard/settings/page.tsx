import { asc } from "drizzle-orm";
import type { Metadata } from "next";

import GsdKeyCard from "@/components/dashboard/settings/gsd-key-card";
import SettingsView from "@/components/dashboard/settings/settings-view";
import type { Category, GsdKeyStatus } from "@/lib/dashboard/types";
import { getDb } from "@/lib/db/client";
import { dashboardCategories } from "@/lib/db/schema";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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

export default async function SettingsPage() {
  // The dashboard layout has already established that the caller is the admin.
  // The GSD key card still reads through Supabase/RLS (Task 7's scope); the
  // category list below reads through Drizzle.
  const db = getDb();
  const supabase = await createServerSupabaseClient();

  // Unlike Links and Notes, this page never filters by workspace: the design
  // renders a Work card and a Home card side by side, so the whole table is the
  // payload rather than a per-workspace slice.
  //
  // Both drizzle-orm's QueryPromise and postgrest-js's PostgrestBuilder are
  // lazy thenables — nothing runs until `.then()`/`await`, so building the two
  // query objects up front does not start them. `Promise.all` is what
  // actually fires both in the same tick; a failed status read is non-fatal
  // (the card starts as "not connected"), but a failed category read is
  // fatal, so each result is still handled on its own terms below.
  const categoriesPromise = db
    .select(CATEGORY_FIELDS)
    .from(dashboardCategories)
    .orderBy(
      asc(dashboardCategories.ctx),
      asc(dashboardCategories.kind),
      asc(dashboardCategories.sort_order)
    );
  // Status only — key_last4/updated_at. The api_key column is never read
  // for display anywhere in the app.
  const keyResultPromise = supabase.from("gsd_config").select("key_last4, updated_at").maybeSingle();

  let categories: Category[];
  let keyResult: Awaited<typeof keyResultPromise>;

  try {
    const [categoryRows, keyRes] = await Promise.all([categoriesPromise, keyResultPromise]);

    categories = categoryRows as Category[];
    keyResult = keyRes;
  } catch (error) {
    console.error("Settings page load error:", error);

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

  if (keyResult.error) {
    console.error("Settings GSD key status error:", keyResult.error);
  }

  const keyStatus: GsdKeyStatus = {
    configured: !keyResult.error && keyResult.data !== null,
    last4: keyResult.data?.key_last4 ?? null,
    updated_at: keyResult.data?.updated_at ?? null,
  };

  return (
    <>
      <SettingsView initialCategories={categories} />
      <GsdKeyCard initialStatus={keyStatus} />
    </>
  );
}
