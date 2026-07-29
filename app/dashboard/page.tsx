import { asc, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import FrequentLinks from "@/components/dashboard/overview/frequent-links";
import OverviewCard from "@/components/dashboard/overview/overview-card";
import RecentNotes from "@/components/dashboard/overview/recent-notes";
import TasksBrief from "@/components/dashboard/overview/tasks-brief";
import TasksBriefSkeleton from "@/components/dashboard/overview/tasks-brief-skeleton";
import type { LinkItem, NoteItem } from "@/lib/dashboard/types";
import { getDb, type DrizzleDb } from "@/lib/db/client";
import { dashboardLinks, dashboardNotes } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Overview",
};

// Cookie reads and the no-store GSD fetch force this anyway; declared to
// match the Tasks page's explicitness.
export const dynamic = "force-dynamic";

/** Mirrors a PostgREST `{ data, error }` result so the error-combination logic
 * below (`notesError = workResult.error ?? homeResult.error`) is unchanged
 * from the Supabase-era page, even though Drizzle throws instead of returning
 * an error object. */
interface QueryResult<T> {
  data: T[];
  error: unknown;
}

async function fetchWorkspaceNotes(
  db: DrizzleDb,
  ctx: "work" | "home"
): Promise<QueryResult<NoteItem>> {
  try {
    // dashboard_notes has no columns beyond NoteItem's contract, so a plain
    // `select()` does not leak anything (unlike dashboard_categories).
    const rows = (await db
      .select()
      .from(dashboardNotes)
      .where(eq(dashboardNotes.ctx, ctx))
      .orderBy(desc(dashboardNotes.updated_at))
      .limit(5)) as NoteItem[];

    return { data: rows, error: null };
  } catch (error) {
    return { data: [], error };
  }
}

async function fetchWorkspaceLinks(
  db: DrizzleDb,
  ctx: "work" | "home"
): Promise<QueryResult<LinkItem>> {
  try {
    const rows = (await db
      .select()
      .from(dashboardLinks)
      .where(eq(dashboardLinks.ctx, ctx))
      .orderBy(desc(dashboardLinks.click_count), asc(dashboardLinks.title))
      .limit(5)) as LinkItem[];

    return { data: rows, error: null };
  } catch (error) {
    return { data: [], error };
  }
}

/**
 * Post-login briefing: due & overdue tasks (streamed — GSD is an external
 * call and must not block the page), then recent notes. The notes queries
 * are fast reads, awaited before first byte; per-workspace limits keep one
 * workspace from starving the other in the client-side re-filter.
 */
export default async function OverviewPage() {
  // The dashboard layout has already established that the caller is the admin.
  const db = getDb();

  const [workResult, homeResult, workLinksResult, homeLinksResult] = await Promise.all([
    fetchWorkspaceNotes(db, "work"),
    fetchWorkspaceNotes(db, "home"),
    fetchWorkspaceLinks(db, "work"),
    fetchWorkspaceLinks(db, "home"),
  ]);

  const notesError = workResult.error ?? homeResult.error;

  if (notesError) {
    console.error("Overview notes load error:", notesError);
  }

  const workNotes: NoteItem[] = workResult.data ?? [];
  const homeNotes: NoteItem[] = homeResult.data ?? [];

  if (workLinksResult.error || homeLinksResult.error) {
    console.error(
      "Overview links load error:",
      workLinksResult.error ?? homeLinksResult.error
    );
  }

  const workLinks: LinkItem[] = workLinksResult.data ?? [];
  const homeLinks: LinkItem[] = homeLinksResult.data ?? [];

  return (
    <>
      <OverviewCard title="Needs attention" meta="project-gsd" href="/dashboard/tasks">
        <Suspense fallback={<TasksBriefSkeleton />}>
          <TasksBrief />
        </Suspense>
      </OverviewCard>

      {notesError ? (
        <section className="rounded-2xl border border-border bg-surface p-5 shadow">
          <h2 className="font-heading text-[17px] font-semibold">Recent notes</h2>
          <p className="mt-2 text-sm text-text-2">
            Notes could not be loaded. Reload the page — if it keeps failing, the dashboard
            tables are unavailable.
          </p>
        </section>
      ) : (
        <RecentNotes workNotes={workNotes} homeNotes={homeNotes} />
      )}

      <FrequentLinks workLinks={workLinks} homeLinks={homeLinks} />
    </>
  );
}
