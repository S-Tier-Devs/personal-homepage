import { desc } from "drizzle-orm";
import type { Metadata } from "next";

import DocumentsView from "@/components/dashboard/documents/documents-view";
import type { DocumentItem } from "@/lib/dashboard/types";
import { getDb } from "@/lib/db/client";
import { filesMetadata } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Documents",
};

/**
 * The wire shape for a document. See app/api/files/route.ts for why this has
 * to be named explicitly rather than selecting every column: `storage_path`
 * and `uploaded_by` are excluded, matching the Supabase-era `FILE_COLUMNS`
 * (lib/dashboard/files.ts).
 */
const FILE_FIELDS = {
  id: filesMetadata.id,
  file_name: filesMetadata.file_name,
  file_size_bytes: filesMetadata.file_size_bytes,
  visibility: filesMetadata.visibility,
  created_at: filesMetadata.created_at,
  description: filesMetadata.description,
  mime_type: filesMetadata.mime_type,
  file_extension: filesMetadata.file_extension,
};

export default async function DocumentsPage() {
  // The dashboard layout has already established that the caller is the admin.
  const db = getDb();

  // One flat list. `files_metadata` has no `ctx` column — documents are not
  // workspace-scoped, so unlike Links there is nothing to split by workspace.
  let documents: DocumentItem[];

  try {
    documents = (await db
      .select(FILE_FIELDS)
      .from(filesMetadata)
      .orderBy(desc(filesMetadata.created_at))) as DocumentItem[];
  } catch (error) {
    console.error("Documents page load error:", error);

    return (
      <section className="rounded-2xl border border-border bg-surface p-5 shadow">
        <h2 className="font-heading text-[17px] font-semibold">Documents</h2>
        <p className="mt-2 text-sm text-text-2">
          Documents could not be loaded. Reload the page — if it keeps failing, the file
          metadata table is unavailable.
        </p>
      </section>
    );
  }

  return <DocumentsView initialDocuments={documents} />;
}
