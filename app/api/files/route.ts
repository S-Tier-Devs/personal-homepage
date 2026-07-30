import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import { apiError, logQueryError } from "@/lib/dashboard/api";
import type { DocumentItem } from "@/lib/dashboard/types";
import { filesMetadata } from "@/lib/db/schema";

/**
 * The wire shape for a document. `storage_path` and `uploaded_by` are
 * deliberately excluded — nothing in the UI needs them, and the storage path
 * is the one field worth not handing out.
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

/**
 * GET /api/files
 * Lists every stored document, newest first.
 *
 * Documents are not workspace-scoped: `files_metadata` has no `ctx` column, so
 * there is no `?ctx=` filter here and none is coming.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;

  try {
    const files = (await db
      .select(FILE_FIELDS)
      .from(filesMetadata)
      .orderBy(desc(filesMetadata.created_at))) as DocumentItem[];

    return NextResponse.json({ files }, { status: 200 });
  } catch (error) {
    logQueryError("Files list error:", error);
    return apiError("SERVER_ERROR", "Could not load documents.", 500);
  }
}
