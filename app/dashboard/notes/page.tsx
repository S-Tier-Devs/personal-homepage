import { asc, desc } from "drizzle-orm";
import type { Metadata } from "next";

import NotesView from "@/components/dashboard/notes/notes-view";
import type { Category, NoteItem } from "@/lib/dashboard/types";
import { getDb } from "@/lib/db/client";
import { dashboardCategories, dashboardNotes } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Notes",
};

export default async function NotesPage() {
  // The dashboard layout has already established that the caller is the admin.
  const db = getDb();

  // Both workspaces come back in one pass: a single admin with a handful of
  // rows, so switching workspaces in the client is a filter, not a refetch.
  // Notes sort by `updated_at` — the design's "Recent" for this section is most
  // recently edited, not most recently created.
  let notes: NoteItem[];
  let categories: Category[];

  try {
    // Drizzle types `ctx`/`kind` as plain `text`, wider than the narrower
    // unions on NoteItem/Category; the check constraints guarantee the
    // narrower types at runtime, same cast used for the category twins in
    // lib/dashboard/api.ts. dashboard_notes has no columns beyond NoteItem's
    // contract, so a plain `select()` does not leak anything.
    const [noteRows, categoryRows] = await Promise.all([
      db.select().from(dashboardNotes).orderBy(desc(dashboardNotes.updated_at)),
      db.select().from(dashboardCategories).orderBy(asc(dashboardCategories.sort_order)),
    ]);

    notes = noteRows as NoteItem[];
    categories = categoryRows as Category[];
  } catch (error) {
    console.error("Notes page load error:", error);

    return (
      <section className="rounded-2xl border border-border bg-surface p-5 shadow">
        <h2 className="font-heading text-[17px] font-semibold">Notes</h2>
        <p className="mt-2 text-sm text-text-2">
          Notes could not be loaded. Reload the page — if it keeps failing, the dashboard
          tables are unavailable.
        </p>
      </section>
    );
  }

  return <NotesView initialNotes={notes} categories={categories} />;
}
